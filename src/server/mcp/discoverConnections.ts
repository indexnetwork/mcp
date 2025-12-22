/**
 * Discover Connections Orchestrator
 * Orchestrates the flow: token exchange → discover/new → discover/filter → vibechecks
 */

import {
  exchangePrivyToken,
  callDiscoverNew,
  callDiscoverFilter,
  callVibecheck,
  PrivyTokenExpiredError,
  type DiscoverNewIntent,
  type DiscoverFilterResultItem,
} from '../protocol/client.js';
import { config } from '../config.js';

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
// Helper: Delay for Polling
// =============================================================================

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// Polling Helper: Accumulate + Stability Strategy
// =============================================================================

interface PollDiscoverFilterOptions {
  privyToken: string;
  intentIds: string[];
  maxConnections: number;
}

/**
 * Poll discover/filter with accumulate + stability strategy.
 *
 * Instead of stopping on first non-empty response, this:
 * 1. Accumulates unique connections across multiple polls (by user.id)
 * 2. Stops when: maxConnections reached OR results stabilize OR limits hit
 *
 * "Stable" means the connection count hasn't changed for `stableThreshold` consecutive polls.
 */
async function pollDiscoverFilterWithAccumulation(
  opts: PollDiscoverFilterOptions
): Promise<DiscoverFilterResultItem[]> {
  const { privyToken, intentIds, maxConnections } = opts;
  const { maxAttempts, baseDelayMs, delayStepMs, stableThreshold, maxTotalWaitMs } = config.discoverFilter;

  // Accumulate connections by user.id to dedupe across polls
  const seenByUserId = new Map<string, DiscoverFilterResultItem>();
  let lastCount = 0;
  let stableAttempts = 0;
  const startTime = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check total time limit
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxTotalWaitMs) {
      console.log(`[pollDiscoverFilter] Max total wait (${maxTotalWaitMs}ms) exceeded after ${attempt - 1} attempts`);
      break;
    }

    // Linear backoff delay: baseDelayMs + delayStepMs * (attempt - 1)
    const delayMs = Math.min(baseDelayMs + delayStepMs * (attempt - 1), maxTotalWaitMs - elapsed);
    if (delayMs > 0) {
      console.log(`[discoverConnectionsFromText] Attempt ${attempt}/${maxAttempts}: waiting ${delayMs}ms before calling discover/filter`);
      await delay(delayMs);
    }

    try {
      const filterResponse = await callDiscoverFilter(privyToken, {
        intentIds,
        excludeDiscovered: true,
        page: 1,
        limit: Math.max(maxConnections, 50), // Request at least 50 to catch more results
      });

      // Accumulate new connections
      for (const result of filterResponse.results) {
        const key = result.user.id;
        if (!seenByUserId.has(key)) {
          seenByUserId.set(key, result);
          console.log(`[pollDiscoverFilter] Attempt ${attempt}: added new connection ${key} (total: ${seenByUserId.size})`);
        }
      }

      // Early exit if we hit maxConnections
      if (seenByUserId.size >= maxConnections) {
        console.log(`[pollDiscoverFilter] Reached maxConnections (${maxConnections}) on attempt ${attempt}`);
        break;
      }

      // Check stability
      const currentCount = seenByUserId.size;

      if (currentCount === 0) {
        // No results yet - keep polling without stability check
        console.log(`[discoverConnectionsFromText] Attempt ${attempt}: no results yet, will retry`);
      } else {
        // We have some results - check if stable
        if (currentCount === lastCount) {
          stableAttempts++;
          console.log(`[pollDiscoverFilter] Attempt ${attempt}: count stable at ${currentCount} (stable for ${stableAttempts}/${stableThreshold})`);
        } else {
          // Results changed, reset stability counter
          stableAttempts = 0;
        }

        // Stop if stable for enough consecutive polls
        if (stableAttempts >= stableThreshold) {
          console.log(`[pollDiscoverFilter] Results stable after ${attempt} attempts, stopping`);
          break;
        }

        lastCount = currentCount;
      }
    } catch (error) {
      // Re-throw auth errors - don't continue polling
      if (error instanceof PrivyTokenExpiredError) {
        throw error;
      }
      console.error(`[discoverConnectionsFromText] Attempt ${attempt} failed:`, error);
      // Continue polling on transient errors
    }
  }

  // Return accumulated connections, limited to maxConnections
  const accumulated = Array.from(seenByUserId.values());
  console.log(`[discoverConnectionsFromText] Found ${accumulated.length} connection(s) after polling`);
  return accumulated.slice(0, maxConnections);
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
 * 3. Poll discover/filter to find matching users (accumulate + stability)
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

  // Step C: Poll discover/filter with accumulate + stability strategy
  // The Protocol API has eventual consistency - intents are written synchronously
  // but indexing happens in a background queue. We poll and accumulate results
  // until they stabilize or we hit our configured limits.
  const intentIds = intents.map(i => i.id);

  const filterResults = await pollDiscoverFilterWithAccumulation({
    privyToken,
    intentIds,
    maxConnections: opts.maxConnections,
  });

  // If no results after polling, return empty
  if (filterResults.length === 0) {
    console.log('[discoverConnectionsFromText] No connections found after polling, returning with intents only');
    return { connections: [], intents };
  }

  // Step D: Run vibechecks in parallel
  const vibecheckResults = await Promise.all(
    filterResults.map(async result => {
      try {
        const response = await callVibecheck(privyToken, {
          targetUserId: result.user.id,
          intentIds,
          characterLimit: opts.characterLimit,
        });
        return { userId: result.user.id, synthesis: response.synthesis };
      } catch (error) {
        if (error instanceof PrivyTokenExpiredError) throw error;
        console.error(`[discoverConnectionsFromText] Vibecheck failed for user ${result.user.id}:`, error);
        return { userId: result.user.id, synthesis: '' };
      }
    })
  );

  const synthesisMap = new Map(vibecheckResults.map(r => [r.userId, r.synthesis]));

  // Step E: Build ConnectionForWidget array
  const connections: ConnectionForWidget[] = filterResults.map(result => ({
    user: {
      id: result.user.id,
      name: result.user.name,
      avatar: result.user.avatar,
    },
    mutualIntentCount: result.intents.length,
    synthesis: synthesisMap.get(result.user.id) ?? '',
  }));

  // Step F: Return result
  console.log(`[discoverConnectionsFromText] Returning ${connections.length} connection(s)`);
  return { connections, intents };
}
