/**
 * Protocol API Client
 * Provides typed functions for calling the Index Protocol API endpoints
 */

import { config } from '../config.js';

// =============================================================================
// Errors
// =============================================================================

/**
 * Error thrown when the Protocol API returns 401/403 indicating the Privy
 * access token is invalid or expired. This signals the caller to trigger
 * re-authentication.
 */
export class PrivyTokenExpiredError extends Error {
  constructor(message = 'Privy access token is invalid or expired') {
    super(message);
    this.name = 'PrivyTokenExpiredError';
  }
}

// =============================================================================
// Types
// =============================================================================

export interface DiscoverNewIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
}

export interface DiscoverNewResult {
  intents: DiscoverNewIntent[];
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}

export interface DiscoverFilterUser {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  intro: string | null;
}

export interface DiscoverFilterIntentHit {
  intent: {
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
  };
  totalStake: number;
  reasonings: string[];
}

export interface DiscoverFilterResultItem {
  user: DiscoverFilterUser;
  totalStake: number;
  intents: DiscoverFilterIntentHit[];
}

export interface DiscoverFilterResponse {
  results: DiscoverFilterResultItem[];
  pagination: {
    page: number;
    limit: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    intentIds: string[] | null;
    userIds: string[] | null;
    indexIds: string[] | null;
    sources: any[] | null;
    excludeDiscovered: boolean;
  };
}

export interface DiscoverFilterParams {
  intentIds: string[];
  userIds?: string[];
  indexIds?: string[];
  sources?: Array<{ type: 'file' | 'integration' | 'link'; id: string }>;
  excludeDiscovered?: boolean;
  page?: number;
  limit?: number;
}

export interface VibecheckParams {
  targetUserId: string;
  intentIds?: string[];
  indexIds?: string[];
  characterLimit?: number;
}

export interface VibecheckResponse {
  synthesis: string;
  targetUserId: string;
  contextUserId: string;
}

// =============================================================================
// Token Exchange
// =============================================================================

/**
 * Exchange OAuth token for Privy token
 * This is extracted from tools.ts for reuse
 */
export async function exchangePrivyToken(
  oauthToken: string,
  signal?: AbortSignal
): Promise<string> {
  const tokenPreview = `${oauthToken.slice(0, 8)}...${oauthToken.slice(-8)}`;
  console.log(`[exchangePrivyToken] Exchanging OAuth token ${tokenPreview}`);

  const response = await fetch(`${config.server.baseUrl}/mcp/token/privy/access-token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${oauthToken}`,
    },
    signal: signal ?? AbortSignal.timeout(config.intentExtraction.privyTokenExchangeTimeoutMs),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[exchangePrivyToken] Exchange failed: ${response.status} ${response.statusText} body=${errorBody}`);

    // Try to detect "privy token invalid" from the exchange endpoint
    let parsed: any = null;
    try {
      parsed = JSON.parse(errorBody);
    } catch {
      // ignore
    }

    const errorCode = parsed?.error;
    const msg = String(parsed?.error_description || errorBody || '').toLowerCase();

    if (
      response.status === 401 &&
      (errorCode === 'privy_token_invalid' ||
        msg.includes('privy token invalid') ||
        msg.includes('invalid privy token'))
    ) {
      throw new PrivyTokenExpiredError('Privy token is invalid or expired (exchange)');
    }

    throw new Error(`Failed to exchange token: ${response.status}`);
  }

  const data = await response.json() as { privyAccessToken: string };

  if (!data.privyAccessToken) {
    throw new Error('Token exchange response missing privyAccessToken');
  }

  console.log(`[exchangePrivyToken] Successfully exchanged token`);
  return data.privyAccessToken;
}

// =============================================================================
// Protocol API Calls
// =============================================================================

/**
 * Call POST /discover/new to extract intents from text
 */
export async function callDiscoverNew(
  privyToken: string,
  payload: { text: string },
  signal?: AbortSignal
): Promise<DiscoverNewResult> {
  const apiUrl = `${config.intentExtraction.protocolApiUrl}/discover/new`;
  console.log('[callDiscoverNew] Calling Protocol API:', apiUrl);

  const tokenPreview =
    typeof privyToken === 'string' && privyToken.length > 10
      ? `${privyToken.slice(0, 10)}...`
      : '<invalid-token>';
  console.debug(`[callDiscoverNew] Using Privy bearer token (truncated): ${tokenPreview}`);

  const formData = new FormData();
  formData.append('payload', payload.text);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${privyToken}`,
    },
    body: formData,
    signal: signal ?? AbortSignal.timeout(config.intentExtraction.protocolApiTimeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');

    // Try to parse structured error if it's JSON
    let parsed: any = null;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      // ignore
    }

    const message =
      (parsed && (parsed.error || parsed.message)) ||
      errorText ||
      `Protocol API error ${response.status}`;

    // Detect expired/invalid privy token
    if (response.status === 401 || response.status === 403) {
      const lower = String(message).toLowerCase();
      if (
        lower.includes('invalid or expired access token') ||
        lower.includes('invalid privy token') ||
        lower.includes('expired privy token')
      ) {
        console.error(
          `[callDiscoverNew] Privy token expired or invalid: status=${response.status} body=${errorText}`,
        );
        throw new PrivyTokenExpiredError(message);
      }
    }

    console.error(`[callDiscoverNew] Protocol API error: ${response.status} body=${errorText}`);
    throw new Error(`discover/new failed: ${response.status}`);
  }

  const data = await response.json() as DiscoverNewResult;
  console.log(`[callDiscoverNew] Extracted ${data.intentsGenerated} intent(s)`);
  return data;
}

/**
 * Call POST /discover/filter to find matching users
 */
export async function callDiscoverFilter(
  privyToken: string,
  params: DiscoverFilterParams,
  signal?: AbortSignal
): Promise<DiscoverFilterResponse> {
  const apiUrl = `${config.intentExtraction.protocolApiUrl}/discover/filter`;
  console.log('[callDiscoverFilter] Calling Protocol API:', apiUrl);

  // Enforce limits
  const limit = Math.min(params.limit ?? 50, 100);

  const body = {
    intentIds: params.intentIds,
    userIds: params.userIds,
    indexIds: params.indexIds,
    sources: params.sources,
    excludeDiscovered: params.excludeDiscovered ?? true,
    page: params.page ?? 1,
    limit,
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${privyToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(config.intentExtraction.protocolApiTimeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');

    // Try to parse structured error if it's JSON
    let parsed: any = null;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      // ignore
    }

    const message =
      (parsed && (parsed.error || parsed.message)) ||
      errorText ||
      `Protocol API error ${response.status}`;

    // Detect expired/invalid privy token
    if (response.status === 401 || response.status === 403) {
      const lower = String(message).toLowerCase();
      if (
        lower.includes('invalid or expired access token') ||
        lower.includes('invalid privy token') ||
        lower.includes('expired privy token')
      ) {
        console.error(
          `[callDiscoverFilter] Privy token expired or invalid: status=${response.status} body=${errorText}`,
        );
        throw new PrivyTokenExpiredError(message);
      }
    }

    console.error(`[callDiscoverFilter] Protocol API error: ${response.status} body=${errorText}`);
    throw new Error(`discover/filter failed: ${response.status}`);
  }

  const data = await response.json() as DiscoverFilterResponse;
  console.log(`[callDiscoverFilter] Found ${data.results.length} user(s)`);
  return data;
}

/**
 * Call POST /synthesis/vibecheck to generate synthesis for a user
 */
export async function callVibecheck(
  privyToken: string,
  params: VibecheckParams,
  signal?: AbortSignal
): Promise<VibecheckResponse> {
  const apiUrl = `${config.intentExtraction.protocolApiUrl}/synthesis/vibecheck`;
  console.log('[callVibecheck] Calling Protocol API for user:', params.targetUserId);

  const body: any = {
    targetUserId: params.targetUserId,
  };

  if (params.intentIds) {
    body.intentIds = params.intentIds;
  }

  if (params.indexIds) {
    body.indexIds = params.indexIds;
  }

  if (params.characterLimit) {
    body.options = { characterLimit: params.characterLimit };
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${privyToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(config.intentExtraction.protocolApiTimeoutMs),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');

    // Try to parse structured error if it's JSON
    let parsed: any = null;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      // ignore
    }

    const message =
      (parsed && (parsed.error || parsed.message)) ||
      errorText ||
      `Protocol API error ${response.status}`;

    // Detect expired/invalid privy token
    if (response.status === 401 || response.status === 403) {
      const lower = String(message).toLowerCase();
      if (
        lower.includes('invalid or expired access token') ||
        lower.includes('invalid privy token') ||
        lower.includes('expired privy token')
      ) {
        console.error(
          `[callVibecheck] Privy token expired or invalid: status=${response.status} body=${errorText}`,
        );
        throw new PrivyTokenExpiredError(message);
      }
    }

    console.error(`[callVibecheck] Protocol API error: ${response.status} body=${errorText}`);
    throw new Error(`vibecheck failed: ${response.status}`);
  }

  const data = await response.json() as VibecheckResponse;
  console.log(`[callVibecheck] Generated synthesis for user ${params.targetUserId}: ${data.synthesis.length} chars`);
  return data;
}
