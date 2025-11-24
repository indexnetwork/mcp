import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Request, Response as ExpressResponse } from "express";
import cors from "cors";
import { z } from "zod";
import { join } from "path";
import { readFileSync, existsSync } from 'fs';
import {
  authenticatePrivy,
  type AuthenticatedRequest
} from "./auth";
import type { TokenEndpointResponse } from "./oauth";
import {
  type AuthorizationPageContext,
  authorizationServerMetadata,
  completeAuthorization,
  exchangeCodeForTokens,
  prepareAuthorization,
  protectedResourceMetadata,
  refreshAccessToken,
  registerClient,
  revokeToken,
  serializeAuthorizationContext,
  listSupportedScopes,
  getPrivyTokenExchangePayload
} from "./oauth";

// Widget definition - reads built HTML at server startup
const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
const widgetHtmlPrimaryPath = join(__dirname, '../widgets/dist/widgets/index.html');
const widgetHtmlFallbackPath = join(__dirname, '../widgets/dist/src/echo/index.html');
const discoverWidgetHtmlPrimaryPath = join(__dirname, '../widgets/dist/widgets/index-discover.html');
const discoverWidgetHtmlFallbackPath = join(__dirname, '../widgets/src/discover/index.html');
const consentHtmlPrimaryPath = join(__dirname, '../widgets/dist/oauth/index.html');
const consentHtmlFallbackPath = join(__dirname, '../widgets/dist/src/oauth-consent/index.html');
const protocolApiTimeoutMs = Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000');
const privyTokenExchangeTimeoutMs = Number(process.env.PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS ?? '10000');
const sectionCharLimit = Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000');
const instructionCharLimit = Number(process.env.EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT ?? '2000');
const privyTokenExchangeUrl = `${normalizedBaseUrl}/privy/access-token`;
const MAX_FILTER_ITEMS = 20;
const MIN_PAGINATION_LIMIT = 1;
const MAX_PAGINATION_LIMIT = 100;
const VIBECHECK_DEFAULT_CONCURRENCY = 2;
const VIBECHECK_MAX_CONCURRENCY = 5;
const VIBECHECK_THROTTLE_MS = 75;
const VIBECHECK_RETRY_DELAYS_MS = [250, 500];

function readFileWithFallback(primary: string, fallback: string) {
  if (existsSync(primary)) {
    return readFileSync(primary, 'utf-8');
  }
  if (existsSync(fallback)) {
    return readFileSync(fallback, 'utf-8');
  }
  throw new Error(`Missing required asset. Checked:\n - ${primary}\n - ${fallback}`);
}

let widgetHtml = readFileWithFallback(widgetHtmlPrimaryPath, widgetHtmlFallbackPath);
let discoverWidgetHtml = readFileWithFallback(discoverWidgetHtmlPrimaryPath, discoverWidgetHtmlFallbackPath);
//TODO!: Get item from MEMORY. Implemented needs to be tested.

function rewriteAssetUrls(html: string, route: string) {
  return html.replace(
    /(src|href)="\/([^"]+)"/g,
    (_match, attr: string, path: string) => {
      const suffix = path.startsWith(`${route}/`) ? path.slice(route.length + 1) : path;
      const normalizedPath = suffix ? `${route}/${suffix}` : route;
      return `${attr}="${normalizedBaseUrl}/${normalizedPath}"`;
    }
  );
}

// Fix asset paths to point to server
widgetHtml = rewriteAssetUrls(widgetHtml, 'widgets');
discoverWidgetHtml = rewriteAssetUrls(discoverWidgetHtml, 'widgets');

function readConsentTemplate() {
  return readFileWithFallback(consentHtmlPrimaryPath, consentHtmlFallbackPath);
}

function renderAuthorizationPage(context: AuthorizationPageContext) {
  const template = readConsentTemplate();
  const contextJson = serializeAuthorizationContext(context);
  const htmlWithContext = template.replace('__OAUTH_CONTEXT__', contextJson);
  return rewriteAssetUrls(htmlWithContext, 'oauth-assets');
}

interface DiscoveryIntentRecord {
  id: string;
  payload: string;
  summary?: string | null;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceId?: string | null;
  sourceType?: string | null;
}

interface DiscoverUserRecord {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  intro?: string | null;
}

interface DiscoverIntentStake {
  intent: {
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
  };
  totalStake: number;
  reasonings: string[];
}

interface DiscoverResultRecord {
  user: DiscoverUserRecord;
  totalStake: number;
  intents: DiscoverIntentStake[];
}

interface DiscoverFilterResponse {
  results: DiscoverResultRecord[];
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
    sources: Array<{ type: string; id: string }> | null;
    excludeDiscovered?: boolean;
  };
}

interface VibeCheckResponsePayload {
  synthesis: string;
  targetUserId: string;
  contextUserId: string;
}

interface DiscoverCard {
  header: {
    title: string;
    subtitle?: string;
    badge?: string;
  };
  body: {
    context: string;
    stats: Array<{ label: string; value: string | number }>;
    vibecheck: string;
  };
  actions: Array<{ label: string; hint?: string; action: string; payload?: Record<string, unknown> }>;
  markup: string;
}

interface DiscoveryRequestResponsePayload {
  success: boolean;
  intents: DiscoveryIntentRecord[];
  filesProcessed: number;
  linksProcessed: number;
  intentsGenerated: number;
}

interface PrivyTokenResponsePayload {
  privyAccessToken?: string;
  expiresAt?: number | null;
  issuedAt?: number | null;
  userId?: string | null;
  scope?: string[];
  error?: string;
  error_description?: string;
}

interface IntentPayloadBuildResult {
  combinedText: string;
  sectionCount: number;
}

function ensureProtocolApiBaseUrl(): string {
  const base = process.env.PROTOCOL_API_URL;
  if (!base) {
    throw new Error('PROTOCOL_API_URL is not configured.');
  }
  return base.replace(/\/$/, '');
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…`;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const entries = Object.entries(value).filter(([, v]) => typeof v !== 'undefined' && v !== null);
  return Object.fromEntries(entries) as T;
}

function enforceArrayLimit<T>(input: T[] | undefined, label: string): T[] | undefined {
  if (!input) {
    return input;
  }
  if (input.length > MAX_FILTER_ITEMS) {
    throw new Error(`${label} cannot include more than ${MAX_FILTER_ITEMS} entries.`);
  }
  return input;
}

function buildIntentPayload(input: {
  fullInputText: string;
  rawText?: string;
  conversationHistory?: string;
  userMemory?: string;
}): IntentPayloadBuildResult {
  const sections: Array<{ label: string; text: string }> = [];
  const addSection = (label: string, value?: string) => {
    if (value && value.trim()) {
      sections.push({ label, text: value.trim() });
    }
  };

  addSection('Full Input', input.fullInputText);
  addSection('Uploaded File', input.rawText);
  addSection('Conversation History', input.conversationHistory);
  addSection('User Memory', input.userMemory);

  const labeledBlocks = sections
    .map(({ label, text }) => `=== ${label} ===\n${truncateText(text, sectionCharLimit)}`)
    .join('\n\n');

  const parts: string[] = [];
  if (input.fullInputText && input.fullInputText.trim().length > 0) {
    parts.push(`User instruction: ${truncateText(input.fullInputText.trim(), instructionCharLimit)}`);
  }

  if (labeledBlocks) {
    parts.push(labeledBlocks);
  }

  return {
    combinedText: parts.join('\n\n').trim(),
    sectionCount: sections.length,
  };
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return response;
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonIfPresent<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return undefined;
}

async function exchangePrivyToken(accessToken: string) {
  const response = await fetchWithTimeout(
    privyTokenExchangeUrl,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    privyTokenExchangeTimeoutMs,
    'Privy token exchange'
  );

  const body = await parseJsonIfPresent<PrivyTokenResponsePayload>(response);
  if (!response.ok) {
    const message = body?.error_description || body?.error || response.statusText;
    throw new Error(`Privy token exchange failed (${response.status}): ${message}`);
  }

  if (!body?.privyAccessToken) {
    throw new Error('Token exchange response missing privyAccessToken');
  }

  return {
    token: body.privyAccessToken,
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : undefined,
  };
}

async function submitDiscoveryRequest(privyToken: string, payload: string) {
  const baseUrl = ensureProtocolApiBaseUrl();
  const formData = new FormData();
  formData.append('payload', payload);

  const response = await fetchWithTimeout(
    `${baseUrl}/discover/new`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${privyToken}`,
      },
      body: formData,
    },
    protocolApiTimeoutMs,
    'Discovery request'
  );

  const body = await parseJsonIfPresent<DiscoveryRequestResponsePayload>(response);
  if (!response.ok || !body) {
    const message = (body as any)?.error || response.statusText;
    throw new Error(`Protocol API error (${response.status}): ${message}`);
  }

  if (!body.success) {
    throw new Error('Protocol API returned an unsuccessful status.');
  }

  return body;
}

async function runDiscoverFilterRequest(privyToken: string, payload: Record<string, unknown>) {
  const baseUrl = ensureProtocolApiBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/discover/filter`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${privyToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    },
    protocolApiTimeoutMs,
    'Discover filter'
  );

  const body = await parseJsonIfPresent<DiscoverFilterResponse>(response);
  if (!response.ok || !body) {
    const message = (body as any)?.error || response.statusText;
    throw new Error(`Discover filter failed (${response.status}): ${message}`);
  }

  return body;
}

async function runVibeCheckRequest(options: {
  privyToken: string;
  targetUserId: string;
  intentIds: string[];
  indexIds?: string[];
  characterLimit?: number;
}) {
  const baseUrl = ensureProtocolApiBaseUrl();
  const response = await fetchWithTimeout(
    `${baseUrl}/synthesis/vibecheck`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.privyToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(
        pruneUndefined({
          targetUserId: options.targetUserId,
          intentIds: options.intentIds,
          indexIds: options.indexIds,
          options: options.characterLimit ? { characterLimit: options.characterLimit } : undefined,
        })
      ),
    },
    protocolApiTimeoutMs,
    'VibeCheck synthesis'
  );

  const body = await parseJsonIfPresent<VibeCheckResponsePayload>(response);
  if (!response.ok || !body) {
    const message = (body as any)?.error || response.statusText;
    throw new Error(`VibeCheck failed (${response.status}): ${message}`);
  }

  return body;
}

async function runVibeChecksForResults(options: {
  privyToken: string;
  results: DiscoverFilterResponse['results'];
  intentIds: string[];
  indexIds?: string[];
  concurrency?: number;
  characterLimit?: number;
}) {
  const {
    privyToken,
    results,
    intentIds,
    indexIds,
    concurrency = VIBECHECK_DEFAULT_CONCURRENCY,
    characterLimit,
  } = options;

  const limit = Math.min(Math.max(concurrency, 1), VIBECHECK_MAX_CONCURRENCY);
  const vibechecks: Array<{ targetUserId: string; synthesis: string }> = new Array(results.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < results.length) {
      const current = nextIndex++;
      const candidate = results[current];
      if (!candidate) {
        continue;
      }

      vibechecks[current] = await runVibeCheckWithRetries({
        privyToken,
        targetUserId: candidate.user.id,
        intentIds,
        indexIds,
        characterLimit,
      });

      await delay(VIBECHECK_THROTTLE_MS);
    }
  };

  const workers = Array.from({ length: Math.min(limit, results.length || 1) }, () => worker());
  await Promise.all(workers);
  return vibechecks;
}

async function runVibeCheckWithRetries(options: {
  privyToken: string;
  targetUserId: string;
  intentIds: string[];
  indexIds?: string[];
  characterLimit?: number;
}) {
  let attempt = 0;
  while (attempt <= VIBECHECK_RETRY_DELAYS_MS.length) {
    try {
      const response = await runVibeCheckRequest(options);
      return {
        targetUserId: response.targetUserId,
        synthesis: response.synthesis || '',
      };
    } catch (error) {
      attempt += 1;
      if (attempt > VIBECHECK_RETRY_DELAYS_MS.length) {
        console.error('[discover_filter] VibeCheck error', {
          targetUserId: options.targetUserId,
          error,
        });
        return {
          targetUserId: options.targetUserId,
          synthesis: '',
        };
      }
      await delay(VIBECHECK_RETRY_DELAYS_MS[attempt - 1]);
    }
  }

  return {
    targetUserId: options.targetUserId,
    synthesis: '',
  };
}

function buildCardMarkup(card: Pick<DiscoverCard, 'header' | 'body'>): string {
  const stats = card.body.stats.map((stat) => `- ${stat.label}: ${stat.value}`).join('\n');
  return `### ${card.header.title}${card.header.badge ? ` (${card.header.badge})` : ''}
${card.body.context}
${stats ? `${stats}\n` : ''}
_${card.body.vibecheck || 'VibeCheck summary unavailable.'}_`;
}

function createCardsFromResults(options: {
  results: DiscoverFilterResponse['results'];
  vibechecks: Array<{ targetUserId: string; synthesis: string }>;
}): DiscoverCard[] {
  const cards: DiscoverCard[] = [];
  options.results.forEach((result, index) => {
    const vibecheck = options.vibechecks[index];
    const stats = [
      { label: 'Shared intents', value: result.intents.length },
      { label: 'Total stake', value: result.totalStake }
    ];
    const context = result.intents
      .map((intent, idx) => `${idx + 1}. ${intent.intent.payload}`)
      .join('\n');
    const header = {
      title: result.user.name || 'Unknown collaborator',
      subtitle: result.user.intro || undefined,
      badge: result.intents.length ? `${result.intents.length} intents` : undefined,
    };
    const body = {
      context: context || 'No shared intents found yet.',
      stats,
      vibecheck: vibecheck?.synthesis || 'VibeCheck summary unavailable.',
    };
    const actions = [
        {
          label: 'Connect',
          hint: 'Start a connection workflow',
          action: 'connect',
          payload: { userId: result.user.id },
        },
        {
          label: 'Save',
          hint: 'Save this match for later review',
          action: 'save',
          payload: { userId: result.user.id },
        },
    ];
    const card: DiscoverCard = {
      header,
      body,
      actions,
      markup: buildCardMarkup({ header, body }),
    };
    cards.push(card);
  });
  return cards;
}

function buildDiscoverSummary(options: {
  generatedIntentCount: number;
  matchCount: number;
  pagination: DiscoverFilterResponse['pagination'];
  vibecheckFailures: number;
}): string {
  const parts = [] as string[];
  if (options.generatedIntentCount > 0) {
    parts.push(`Generated ${options.generatedIntentCount} intent${options.generatedIntentCount === 1 ? '' : 's'}`);
  }
  parts.push(`Found ${options.matchCount} match${options.matchCount === 1 ? '' : 'es'}`);
  const pageInfo = `page ${options.pagination.page}/${options.pagination.hasNext ? options.pagination.page + 1 : options.pagination.page}`;
  parts.push(`showing ${options.pagination.limit} per page (${pageInfo})`);
  if (options.vibecheckFailures > 0) {
    parts.push(`VibeCheck unavailable for ${options.vibecheckFailures} candidate${options.vibecheckFailures === 1 ? '' : 's'}`);
  }
  return parts.join(' · ');
}

function buildMockDiscoverData() {
  const generatedIntents: DiscoveryIntentRecord[] = [
    {
      id: 'mock-intent-1',
      payload: 'Find privacy-preserving AI research partners',
      summary: 'Looking for collaborators on confidential compute projects',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'mock-intent-2',
      payload: 'Source stealth AI startups building secure infra',
      summary: 'Prefer founders with experience shipping in regulated markets',
      createdAt: new Date().toISOString(),
    },
  ];

  const results: DiscoverFilterResponse['results'] = [
    {
      user: {
        id: 'mock-user-1',
        name: 'Alice Turner',
        email: 'alice@example.com',
        avatar: null,
        intro: 'Founder @ Prism Labs — encrypted machine learning infra',
      },
      totalStake: 180,
      intents: [
        {
          intent: {
            id: 'mock-intent-1a',
            payload: 'Seeking privacy-first investors for confidential compute platform',
            summary: 'Raising seed extension focused on secure AI infra',
            createdAt: new Date().toISOString(),
          },
          totalStake: 120,
          reasonings: ['Shares the same target industries and compliance focus.'],
        },
      ],
    },
    {
      user: {
        id: 'mock-user-2',
        name: 'Benicio Shah',
        email: 'benicio@example.com',
        avatar: null,
        intro: 'Operator building AI policy networks in LatAm',
      },
      totalStake: 95,
      intents: [
        {
          intent: {
            id: 'mock-intent-2a',
            payload: 'Looking for privacy experts to mentor our accelerator cohorts',
            summary: 'Focus on AI safety + secure infra founders',
            createdAt: new Date().toISOString(),
          },
          totalStake: 95,
          reasonings: ['Could connect you to vetted founders needing secure infra guidance.'],
        },
      ],
    },
    {
      user: {
        id: 'mock-user-3',
        name: 'Clara Mendes',
        email: 'clara@example.com',
        avatar: null,
        intro: 'Chief of Staff @ Aurora Ventures, leads AI diligence',
      },
      totalStake: 140,
      intents: [
        {
          intent: {
            id: 'mock-intent-3a',
            payload: 'Interested in LPs targeting privacy-tech ecosystems',
            summary: 'Scouting co-investors with privacy + AI thesis overlap',
            createdAt: new Date().toISOString(),
          },
          totalStake: 140,
          reasonings: ['Direct overlap with your secure infra thesis; she already staked on similar founders.'],
        },
      ],
    },
  ];

  const discoverResponse: DiscoverFilterResponse = {
    results,
    pagination: {
      page: 1,
      limit: 50,
      hasNext: false,
      hasPrev: false,
    },
    filters: {
      intentIds: generatedIntents.map((intent) => intent.id),
      userIds: null,
      indexIds: null,
      sources: null,
      excludeDiscovered: true,
    },
  };

  const vibechecks = results.map((result, idx) => ({
    targetUserId: result.user.id,
    synthesis: `VibeCheck: ${result.user.name} complements your intent ${idx + 1} by filling gaps around ${result.intents[0]?.intent.summary ?? 'shared goals'}.`,
  }));

  return { discoverResponse, vibechecks, generatedIntents };
}

function summarizeIntents(intents: DiscoveryIntentRecord[]): string {
  if (!intents || intents.length === 0) {
    return 'No intents detected.';
  }
  return intents
    .map((intent, index) => `${index + 1}. ${intent.payload}`)
    .join('\n');
}

/**
 * Echo widget configuration for ChatGPT integration
 */
const indexEchoWidget = {
  id: "index-echo",
  title: "Index Echo",
  templateUri: "ui://widget/index-echo.html",
  resourceName: "index-echo",
  invoking: "Rendering echo card",
  invoked: "Rendered echo card",
  mimeType: "text/html+skybridge",
  html: widgetHtml
};

const indexDiscoverWidget = {
  id: "index-discover",
  title: "Index Discover",
  templateUri: "ui://widget/index-discover.html",
  resourceName: "index-discover",
  invoking: "Rendering discovery cards",
  invoked: "Rendered discovery cards",
  mimeType: "text/html+skybridge",
  html: discoverWidgetHtml
};


const server = new McpServer({
  name: "index-mcp-server",
  version: "1.0.1"
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});

server.registerResource(indexEchoWidget.resourceName, indexEchoWidget.templateUri, {}, async () => ({
  contents: [
    {
      uri: indexEchoWidget.templateUri,
      mimeType: indexEchoWidget.mimeType,
      text: indexEchoWidget.html,
      title: indexEchoWidget.title,
      _meta: {
        "openai/widgetAccessible": true,
        "openai/resultCanProduceWidget": true,
        "openai/outputTemplate": indexEchoWidget.templateUri,
        "openai/toolInvocation/invoking": indexEchoWidget.invoking,
        "openai/toolInvocation/invoked": indexEchoWidget.invoked,
      }
    }
  ]
}));

server.registerResource(indexDiscoverWidget.resourceName, indexDiscoverWidget.templateUri, {}, async () => ({
  contents: [
    {
      uri: indexDiscoverWidget.templateUri,
      mimeType: indexDiscoverWidget.mimeType,
      text: indexDiscoverWidget.html,
      title: indexDiscoverWidget.title,
      _meta: {
        "openai/widgetAccessible": true,
        "openai/resultCanProduceWidget": true,
        "openai/outputTemplate": indexDiscoverWidget.templateUri,
        "openai/toolInvocation/invoking": indexDiscoverWidget.invoking,
        "openai/toolInvocation/invoked": indexDiscoverWidget.invoked,
      }
    }
  ]
}));

// Single echo tool for testing
server.registerTool("echo", {
  title: "Echo Tool",
  description: "Echo back the provided message",
  inputSchema: { message: z.string() },
  _meta: {
    "openai/outputTemplate": indexEchoWidget.templateUri,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  }
}, async ({ message }) => {
  return {
    content: [{ type: "text", text: `Echo: ${message}` }],
    structuredContent: { message },
    _meta: {
      "openai/toolInvocation/invoking": indexEchoWidget.invoking,
      "openai/toolInvocation/invoked": indexEchoWidget.invoked,
    }
  };
});

// Universal intent extraction tool with multi-intent support
server.registerTool("extract_intent", {
  title: "Analyze Conversation Intent",
  description: "Extracts and structures the user's goals, needs, or objectives from any conversation to help understand what they're trying to accomplish.",
  inputSchema: {
    fullInputText: z.string().describe("Full input text"),
    rawText: z.string().optional().describe("Raw text content from uploaded file"),
    conversationHistory: z.string().optional().describe("Raw conversation history as text"),
    userMemory: z.string().optional().describe("Raw user memory/context as text"),
  },
  annotations: {
    readOnlyHint: true
  }
}, async (input, extra) => {
  try {
    const authToken = extra?.authInfo?.token;
    if (!authToken) {
      throw new Error('Missing authentication context for extract_intent invocation.');
    }

    const { combinedText, sectionCount } = buildIntentPayload(input);
    if (!combinedText) {
      return {
        content: [{ type: 'text', text: 'No input content provided for intent extraction.' }],
        structuredContent: {
          intents: [],
          filesProcessed: 0,
          linksProcessed: 0,
          intentsGenerated: 0,
        },
      };
    }

    console.log(`[extract_intent] Forwarding ${combinedText.length} chars across ${sectionCount} sections to protocol API`);

    const privyToken = await exchangePrivyToken(authToken);
    const discoveryResponse = await submitDiscoveryRequest(privyToken.token, combinedText);
    const summary = summarizeIntents(discoveryResponse.intents);

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        intents: discoveryResponse.intents,
        filesProcessed: discoveryResponse.filesProcessed,
        linksProcessed: discoveryResponse.linksProcessed,
        intentsGenerated: discoveryResponse.intentsGenerated,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extract intents.';
    console.error('[extract_intent] Error', error);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
});

const discoverFilterInputShape = {
  intentIds: z.array(z.string().uuid()).max(MAX_FILTER_ITEMS).optional(),
  userIds: z.array(z.string().uuid()).max(MAX_FILTER_ITEMS).optional(),
  indexIds: z.array(z.string().uuid()).max(MAX_FILTER_ITEMS).optional(),
  sources: z.array(z.object({
    type: z.enum(['file', 'integration', 'link', 'discovery_form']),
    id: z.string().uuid(),
  })).max(MAX_FILTER_ITEMS).optional(),
  excludeDiscovered: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(MIN_PAGINATION_LIMIT).max(MAX_PAGINATION_LIMIT).optional(),
  intentInput: z.object({
    fullInputText: z.string(),
    rawText: z.string().optional(),
    conversationHistory: z.string().optional(),
    userMemory: z.string().optional(),
  }).optional(),
  vibecheck: z.object({
    characterLimit: z.number().int().positive().optional(),
    concurrency: z.number().int().min(1).max(VIBECHECK_MAX_CONCURRENCY).optional(),
  }).optional(),
  mock: z.boolean().optional(),
} as const satisfies Record<string, z.ZodTypeAny>;

const discoverFilterValidator = z.object(discoverFilterInputShape).superRefine((value, ctx) => {
  if (!value.mock) {
    if ((value.intentIds?.length ?? 0) === 0) {
      if (!value.intentInput?.fullInputText?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide either intentIds or intentInput.fullInputText.',
          path: ['intentInput', 'fullInputText'],
        });
      }
    }
  }
});

type DiscoverFilterInput = z.infer<typeof discoverFilterValidator>;

server.registerTool("discover_filter", {
  title: "Discover Filter",
  description: "Creates discovery intents when needed, runs Index discover filtering, and returns card-based summaries with VibeChecks.",
  inputSchema: discoverFilterInputShape,
  annotations: {
    readOnlyHint: true,
  },
  _meta: {
    "openai/outputTemplate": indexDiscoverWidget.templateUri,
    "openai/widgetAccessible": true,
    "openai/resultCanProduceWidget": true,
  }
}, async (rawInput, extra) => {
  try {
    const input = discoverFilterValidator.parse(rawInput) as DiscoverFilterInput;

    if (input.mock) {
      const mock = buildMockDiscoverData();
      const cards = createCardsFromResults({ results: mock.discoverResponse.results, vibechecks: mock.vibechecks });
      const summary = buildDiscoverSummary({
        generatedIntentCount: mock.generatedIntents.length,
        matchCount: mock.discoverResponse.results.length,
        pagination: mock.discoverResponse.pagination,
        vibecheckFailures: mock.vibechecks.filter((entry) => !entry.synthesis).length,
      });
      const cardsMarkup = cards.map((card) => card.markup);
      const structuredContent = {
        ...mock.discoverResponse,
        generatedIntents: mock.generatedIntents,
        vibechecks: mock.vibechecks,
        cards,
        cardsMarkup,
        summary,
        pageHint: {
          hasNext: mock.discoverResponse.pagination.hasNext,
          hasPrev: mock.discoverResponse.pagination.hasPrev,
          nextPage: mock.discoverResponse.pagination.hasNext ? mock.discoverResponse.pagination.page + 1 : null,
          prevPage: mock.discoverResponse.pagination.hasPrev ? mock.discoverResponse.pagination.page - 1 : null,
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: `${summary}\n\n${cardsMarkup.join('\n\n')}`,
          },
        ],
        structuredContent,
        _meta: {
          'openai/toolInvocation/invoking': indexDiscoverWidget.invoking,
          'openai/toolInvocation/invoked': indexDiscoverWidget.invoked,
        },
      };
    }

    const authToken = extra?.authInfo?.token;
    if (!authToken) {
      throw new Error('Missing authentication context for discover_filter invocation.');
    }

    const privyToken = await exchangePrivyToken(authToken);
    let resolvedIntentIds = Array.from(new Set(input.intentIds ?? []));
    let generatedIntents: DiscoveryIntentRecord[] | undefined;

    if (resolvedIntentIds.length === 0) {
      const fullInput = input.intentInput?.fullInputText?.trim();
      if (!fullInput) {
        throw new Error('Provide either intentIds or intentInput.fullInputText.');
      }

      const { combinedText } = buildIntentPayload({
        fullInputText: fullInput,
        rawText: input.intentInput?.rawText,
        conversationHistory: input.intentInput?.conversationHistory,
        userMemory: input.intentInput?.userMemory,
      });

      if (!combinedText) {
        throw new Error('Unable to construct intent payload from provided input.');
      }

      const intentCreation = await submitDiscoveryRequest(privyToken.token, combinedText);
      if (!intentCreation.intents || intentCreation.intents.length === 0) {
        throw new Error('No intents were generated from the provided input.');
      }

      generatedIntents = intentCreation.intents;
      resolvedIntentIds = intentCreation.intents.map((intent) => intent.id).filter(Boolean);
    }

    if (resolvedIntentIds.length === 0) {
      throw new Error('No intents available to run discovery filtering.');
    }

    const sanitizedUserIds = enforceArrayLimit<string>(input.userIds, 'userIds');
    const sanitizedIndexIds = enforceArrayLimit<string>(input.indexIds, 'indexIds');
    const sanitizedSources = enforceArrayLimit(input.sources, 'sources');
    const payload = pruneUndefined({
      intentIds: resolvedIntentIds,
      userIds: sanitizedUserIds,
      indexIds: sanitizedIndexIds,
      sources: sanitizedSources,
      excludeDiscovered: typeof input.excludeDiscovered === 'boolean' ? input.excludeDiscovered : true,
      page: input.page ?? 1,
      limit: input.limit ?? 50,
    });

    const discoverResponse = await runDiscoverFilterRequest(privyToken.token, payload);

    const vibechecks = await runVibeChecksForResults({
      privyToken: privyToken.token,
      results: discoverResponse.results,
      intentIds: resolvedIntentIds,
      indexIds: sanitizedIndexIds,
      concurrency: input.vibecheck?.concurrency,
      characterLimit: input.vibecheck?.characterLimit,
    });

    const vibecheckFailures = vibechecks.filter((entry) => !entry?.synthesis).length;
    const cards = createCardsFromResults({ results: discoverResponse.results, vibechecks });
    const summary = buildDiscoverSummary({
      generatedIntentCount: generatedIntents?.length ?? 0,
      matchCount: discoverResponse.results.length,
      pagination: discoverResponse.pagination,
      vibecheckFailures,
    });

    const cardsMarkup = cards.map((card) => card.markup);
    const structuredContent = {
      ...discoverResponse,
      generatedIntents: generatedIntents ?? null,
      vibechecks,
      cards,
      cardsMarkup,
      summary,
      pageHint: {
        hasNext: discoverResponse.pagination.hasNext,
        hasPrev: discoverResponse.pagination.hasPrev,
        nextPage: discoverResponse.pagination.hasNext ? discoverResponse.pagination.page + 1 : null,
        prevPage: discoverResponse.pagination.hasPrev ? discoverResponse.pagination.page - 1 : null,
      },
    };

    console.log('[discover_filter] invocation', {
      intentCount: resolvedIntentIds.length,
      matches: discoverResponse.results.length,
      vibecheckFailures,
      filters: Object.keys(payload),
    });

    return {
      content: [
        {
          type: 'text',
          text: `${summary}\n\n${cardsMarkup.join('\n\n') || 'No matches found.'}`,
        },
      ],
      structuredContent,
      _meta: {
        'openai/toolInvocation/invoking': indexDiscoverWidget.invoking,
        'openai/toolInvocation/invoked': indexDiscoverWidget.invoked,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run discover filter.';
    console.error('[discover_filter] Error', error);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
});

const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
  origin: '*',
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'mcp-session-id'],
}));

app.use('/widgets', express.static(join(__dirname, '../widgets/dist/widgets'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));
app.use('/oauth-assets', express.static(join(__dirname, '../widgets/dist'), {
  cacheControl: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

function asString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function asScope(
  value: unknown
): string | string[] | undefined {
  if (typeof value === "string" || typeof value === "undefined") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.filter((entry) => typeof entry === "string") as string[];
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function respondOAuthError(res: ExpressResponse, error: unknown): void {
  const oauthError = (error as any)?.oauthError ?? "server_error";
  const description =
    (error as any)?.errorDescription ??
    (error instanceof Error ? error.message : "OAuth error");
  const status = oauthError === "server_error" ? 500 : 400;
  if (status === 500) {
    console.error("OAuth error:", error);
  }
  res
    .status(status)
    .json({ error: oauthError, error_description: description });
}

function getRequestOrigin(req: Request) {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost ?? req.header("host");
  if (!host) {
    return `${normalizedBaseUrl}`;
  }
  return `${proto}://${host}`;
}

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json(authorizationServerMetadata());
});

app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json(protectedResourceMetadata());
});

function buildMcpManifest(req: Request) {
  const origin = getRequestOrigin(req).replace(/\/$/, '');
  return {
    "@context": "https://agent-mcp.org/manifest-1.0",
    "protocol_version": "0.1",
    "name": "index-mcp-server",
    "version": "1.0.1",
    "description": "Index Network MCP server exposing the echo tool and intent logging over OAuth-protected access.",
    "capabilities": {
      "tools": true,
      "resources": true,
      "notifications": false
    },
    "resources": [
      {
        "name": indexEchoWidget.resourceName,
        "uri": indexEchoWidget.templateUri,
        "mime_type": indexEchoWidget.mimeType,
        "description": indexEchoWidget.title
      },
      {
        "name": indexDiscoverWidget.resourceName,
        "uri": indexDiscoverWidget.templateUri,
        "mime_type": indexDiscoverWidget.mimeType,
        "description": indexDiscoverWidget.title
      }
    ],
    "servers": [
      {
        "type": "mcp",
        "url": `${origin}/mcp`
      }
    ],
    "authentication": {
      "type": "oauth2",
      "authorization_url": `${origin}/oauth/authorize`,
      "token_url": `${origin}/oauth/token`,
      "revocation_url": `${origin}/oauth/revoke`,
      "registration_url": `${origin}/oauth/register`,
      "userinfo_url": `${origin}/oauth/userinfo`,
      "scopes": listSupportedScopes()
    },
    "contact": {
      "name": "Index Network Support",
      "email": "hello@index.network"
    },
    "terms_of_service_url": "https://index.network/legal/terms",
    "privacy_policy_url": "https://index.network/legal/privacy"
  };
}

function sendManifest(req: Request, res: ExpressResponse) {
  const manifest = buildMcpManifest(req);
  res.type('application/json').send(JSON.stringify(manifest, null, 2));
}

app.get('/.well-known/mcp.json', (req, res) => {
  sendManifest(req, res);
});

app.get('/.well-known/mcp/manifest.json', (req, res) => {
  sendManifest(req, res);
});

app.get('/.well-known/manifest.json', (req, res) => {
  sendManifest(req, res);
});

app.post('/.well-known/mcp.json', (req, res) => {
  sendManifest(req, res);
});

app.post('/.well-known/mcp/manifest.json', (req, res) => {
  sendManifest(req, res);
});

app.post('/.well-known/manifest.json', (req, res) => {
  sendManifest(req, res);
});

app.post('/oauth/register', (req, res) => {
  try {
    const registration = registerClient(req.body ?? {});
    res
      .status(201)
      .json(registration);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.get('/oauth/authorize', (req, res) => {
  if (!req.query || Object.keys(req.query).length === 0) {
    res.status(204).end();
    return;
  }

  console.log('[oauth] authorize request', req.query);
  try {
    const origin = getRequestOrigin(req);
    const authorizeUri = new URL('/oauth/authorize', origin).toString();
    const completeUri = new URL('/oauth/authorize/complete', origin).toString();

    const pageContext = prepareAuthorization({
      response_type: asString(req.query.response_type),
      client_id: asString(req.query.client_id),
      redirect_uri: asString(req.query.redirect_uri),
      scope: asScope(req.query.scope),
      state: asString(req.query.state),
      code_challenge: asString(req.query.code_challenge),
      code_challenge_method: asString(req.query.code_challenge_method),
      resource: asString(req.query.resource),
      nonce: asString(req.query.nonce),
      authorizeUri,
      completeUri,
    });
    const html = renderAuthorizationPage(pageContext);
    res.type('html').send(html);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.post('/oauth/authorize/complete', async (req, res) => {
  const { state, privyToken, fallbackToken } = req.body ?? {};
  if (!state || !privyToken) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "state and privyToken are required.",
    });
    return;
  }

  try {
    const result = await completeAuthorization({ state, privyToken, fallbackToken });
    res.json(result);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.post('/oauth/token', (req, res) => {
  try {
    const grantType = req.body?.grant_type;
    let payload: TokenEndpointResponse;

    if (grantType === 'authorization_code') {
      payload = exchangeCodeForTokens({
        code: req.body.code,
        code_verifier: req.body.code_verifier,
        client_id: req.body.client_id,
        redirect_uri: req.body.redirect_uri,
      });
    } else if (grantType === 'refresh_token') {
      payload = refreshAccessToken({
        refresh_token: req.body.refresh_token,
        client_id: req.body.client_id,
        scope: req.body.scope,
      });
    } else {
      throw Object.assign(new Error('Unsupported grant_type'), {
        oauthError: 'unsupported_grant_type',
        errorDescription: 'Only authorization_code and refresh_token grants are supported.',
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json(payload);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.post('/oauth/revoke', (req, res) => {
  revokeToken({
    token: req.body?.token,
    token_type_hint: req.body?.token_type_hint,
  });
  res.status(200).json({ revoked: true });
});

app.get('/oauth/userinfo', authenticatePrivy, (req: AuthenticatedRequest, res) => {
  if (!req.privyClaims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const claims = req.privyClaims;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.json({
    sub: claims.user_id,
    privy_user_id: claims.user_id,
    privy_session_id: claims.session_id,
    iss: claims.issuer,
    aud: req.oauth?.clientId,
    scope: req.oauth?.scope.join(' ') ?? '',
    exp: claims.expiration,
    iat: claims.issued_at,
  });
});

app.post('/privy/access-token', authenticatePrivy, (req: AuthenticatedRequest, res) => {
  if (!req.oauth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const scopes = req.oauth.scope || [];
  if (!scopes.includes('privy:token:exchange')) {
    return res.status(403).json({ error: 'insufficient_scope' });
  }

  const payload = getPrivyTokenExchangePayload(req.oauth.accessToken);
  if (!payload) {
    return res.status(404).json({ error: 'token_not_found' });
  }

  const preview = `${payload.privyToken.slice(0, 4)}...${payload.privyToken.slice(-4)}`;
  console.log('[privy] Exchanging token for Privy bearer', preview);

  return res.json({
    privyAccessToken: payload.privyToken,
    expiresAt: payload.expiresAt ?? null,
    issuedAt: payload.issuedAt ?? null,
    userId: payload.userId ?? null,
    scope: payload.scope,
  });
});

/**
 * Main MCP endpoint for stateless communication
 * Handles tool invocations and returns widget responses
 */
app.post('/mcp', authenticatePrivy, async (req: AuthenticatedRequest, res) => {
  try {
    console.log('[mcp] incoming payload', JSON.stringify(req.body));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// Allow basic health check on GET but continue to block DELETE
app.get('/mcp', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Use POST /mcp for MCP requests.'
  });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
});

const PORT = process.env.MCP_SERVER_PORT || 3002;
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});

/**
 * MCP server instance for tool registration and communication
 */
export { server };

/**
 * Express application for serving MCP endpoints and widget assets
 */
export { app };
