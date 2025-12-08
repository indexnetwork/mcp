/**
 * Discover Connections Orchestrator
 * Orchestrates the flow: token exchange → discover/new → discover/filter → vibechecks
 */

import {
  exchangePrivyToken,
  callDiscoverNew,
  callDiscoverFilter,
  callVibecheck,
  type DiscoverNewIntent,
  type VibecheckResponse,
} from '../protocol/client.js';
import { config } from '../config.js';

// =============================================================================
// Constants
// =============================================================================

const VIBECHECK_DEFAULT_CONCURRENCY = 2;
const VIBECHECK_MAX_CONCURRENCY = 5;
const VIBECHECK_THROTTLE_MS = 75;

// =============================================================================
// Types
// =============================================================================

export interface ConnectionForWidget {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  mutualIntentCount: number;
  synthesis: string;
}

export interface DiscoverConnectionsOrchestratorResult {
  connections: ConnectionForWidget[];
  intents: DiscoverNewIntent[];
}

export interface DiscoverConnectionsFromTextOptions {
  oauthToken: string;
  fullInputText: string;
  maxConnections: number;
  characterLimit?: number;
}

// =============================================================================
// Helper: Worker Pool for Vibecheck Calls
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface VibecheckTask {
  userId: string;
  intentIds: string[];
  indexIds?: string[];
  characterLimit?: number;
}

interface VibecheckResult {
  userId: string;
  synthesis: string;
}

/**
 * Run vibecheck tasks with bounded concurrency and throttling
 */
async function runVibechecksWithPool(
  privyToken: string,
  tasks: VibecheckTask[],
  concurrency: number
): Promise<Map<string, VibecheckResult>> {
  const results = new Map<string, VibecheckResult>();

  if (tasks.length === 0) {
    return results;
  }

  const effectiveConcurrency = Math.min(
    concurrency,
    VIBECHECK_MAX_CONCURRENCY,
    tasks.length
  );

  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const taskIndex = nextIndex++;
      if (taskIndex >= tasks.length) {
        break;
      }

      const task = tasks[taskIndex];

      try {
        const response = await callVibecheck(privyToken, {
          targetUserId: task.userId,
          intentIds: task.intentIds,
          indexIds: task.indexIds,
          characterLimit: task.characterLimit,
        });

        results.set(task.userId, {
          userId: task.userId,
          synthesis: response.synthesis,
        });
      } catch (error) {
        // Partial failure tolerance: store empty synthesis on error
        console.error(`[runVibechecksWithPool] Vibecheck failed for user ${task.userId}:`, error);
        results.set(task.userId, {
          userId: task.userId,
          synthesis: '',
        });
      }

      // Throttle between calls
      await delay(VIBECHECK_THROTTLE_MS);
    }
  };

  // Start workers
  const workers = Array.from({ length: effectiveConcurrency }, () => worker());
  await Promise.all(workers);

  return results;
}

// =============================================================================
// Main Orchestrator Function
// =============================================================================

/**
 * Main orchestration function for discover_connections
 *
 * Flow:
 * 1. Exchange OAuth token for Privy token
 * 2. Call discover/new to extract intents
 * 3. Call discover/filter to find matching users
 * 4. Run vibechecks for each user with bounded concurrency
 * 5. Return connections formatted for widget
 */
export async function discoverConnectionsFromText(
  opts: DiscoverConnectionsFromTextOptions
): Promise<DiscoverConnectionsOrchestratorResult> {
  // Step A: Exchange OAuth → Privy token
  const privyToken = await exchangePrivyToken(opts.oauthToken);

  // Step B: Call discover/new
  // Truncate input text using same limits as extract_intent
  const truncatedText = opts.fullInputText.slice(
    0,
    config.intentExtraction.instructionCharLimit
  );

  const discoverNewResult = await callDiscoverNew(privyToken, {
    text: truncatedText,
  });

  const intents = discoverNewResult.intents;

  // If no intents extracted, return empty
  if (intents.length === 0) {
    console.log('[discoverConnectionsFromText] No intents extracted, returning empty');
    return { connections: [], intents: [] };
  }

  // Step C: Call discover/filter with bounded polling
  // The Protocol API has eventual consistency - intents are written synchronously
  // but indexing happens in a background queue. We poll until we get results
  // or hit our configured limits.
  const limit = Math.min(opts.maxConnections, 100);
  const intentIds = intents.map(i => i.id);

  const { maxAttempts, initialDelayMs, maxTotalWaitMs } = config.discoverFilter;
  const startTime = Date.now();
  let attempt = 0;
  let filterResponse: Awaited<ReturnType<typeof callDiscoverFilter>> | null = null;

  while (attempt < maxAttempts) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxTotalWaitMs) {
      console.log(`[discoverConnectionsFromText] Max total wait time (${maxTotalWaitMs}ms) exceeded after ${attempt} attempts`);
      break;
    }

    // Wait before each attempt (including the first one, to give indexer time)
    const delayMs = Math.min(initialDelayMs * (attempt + 1), maxTotalWaitMs - elapsed);
    if (delayMs > 0) {
      console.log(`[discoverConnectionsFromText] Attempt ${attempt + 1}/${maxAttempts}: waiting ${delayMs}ms before calling discover/filter`);
      await delay(delayMs);
    }

    attempt++;

    try {
      filterResponse = await callDiscoverFilter(privyToken, {
        intentIds,
        excludeDiscovered: true,
        page: 1,
        limit,
      });

      // If we got results, we're done polling
      if (filterResponse.results.length > 0) {
        console.log(`[discoverConnectionsFromText] Found ${filterResponse.results.length} connection(s) on attempt ${attempt}`);
        break;
      }

      console.log(`[discoverConnectionsFromText] Attempt ${attempt}: no results yet, will retry`);
    } catch (error) {
      console.error(`[discoverConnectionsFromText] Attempt ${attempt} failed:`, error);
      // Continue polling on transient errors
    }
  }

  // If no results after polling, return empty
  if (!filterResponse || filterResponse.results.length === 0) {
    console.log('[discoverConnectionsFromText] No connections found after polling, returning with intents only');
    return { connections: [], intents };
  }

  // Step D: Run vibechecks with bounded concurrency
  const vibecheckTasks: VibecheckTask[] = filterResponse.results.map(result => ({
    userId: result.user.id,
    intentIds,
    characterLimit: opts.characterLimit,
  }));

  const vibecheckResults = await runVibechecksWithPool(
    privyToken,
    vibecheckTasks,
    VIBECHECK_DEFAULT_CONCURRENCY
  );

  // Step E: Build ConnectionForWidget array
  const connections: ConnectionForWidget[] = filterResponse.results.map(result => {
    const vibecheck = vibecheckResults.get(result.user.id);

    return {
      user: {
        id: result.user.id,
        name: result.user.name,
        avatar: result.user.avatar,
      },
      mutualIntentCount: result.intents.length,
      synthesis: vibecheck?.synthesis ?? '',
    };
  });

  // Step F: Return result
  console.log(`[discoverConnectionsFromText] Returning ${connections.length} connection(s)`);
  return { connections, intents };
}
