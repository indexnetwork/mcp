# Intent Extraction Reference (Based on Current Implementation)

This document captures how intents are actually produced inside the protocol/server stack today so the MCP `extract_intent` tool can align with real behavior instead of the outdated flow described in `oauth-spec.md`.

## 1. Current MCP Tool Behavior (`mcp/src/server.ts:144-186`)

- `extract_intent` is registered alongside the `echo` tool but currently just logs whatever text arrives (`fullInputText`, `rawText`, `conversationHistory`, `userMemory`) and returns `{ text: "ok" }`.
- No intents are generated yet; this spec explains what logic needs to be reused when we wire it up for real.

## 2. How the Protocol Server Generates Intents Today

### 2.1 Discovery Form Pipeline (`../index/protocol/src/routes/discover.ts`)

When the frontend hits `POST /discover/new`, the server performs these concrete steps:

1. **Authentication** – `authenticatePrivy` verifies the caller’s Privy bearer token before any processing happens (lines 49‑61).
2. **File ingestion** – `createUploadClient('discovery', userId)` streams up to 10 files, inserts each into the `files` table, and stores the uploaded blob under the user’s uploads directory (lines 54‑105).
3. **File parsing** – `processUploadedFiles` reads every file, keeps the readable text, and appends it to `combinedContent`, logging recoverable errors instead of failing the request (lines 106‑115).
4. **Link extraction & crawling** – URLs are parsed out of the free‑form payload, inserted into `index_links`, and crawled with `crawlLinksForIndex`. Crawled markdown is persisted per URL and appended to `combinedContent` with a `=== url ===` heading (lines 118‑205).
5. **Instruction prefix** – Any non‑URL payload text is prepended as `User instruction: …` so the analyzer sees original guidance first (lines 207‑214).
6. **Intent creation rules**
   - **Short text shortcut** – If the payload is <100 characters and no files/links were provided, the payload is written straight to the `intents` table via `IntentService.createIntent` (lines 217‑237).
   - **LLM extraction path** – Otherwise the server builds `contentObjects = [{ name: 'discovery-content', content: combinedContent }]` and hands them to `analyzeObjects` with the user’s instruction, requesting 1 intent (lines 238‑259).
7. **Persistence** – For each inferred payload the server picks `sourceId = savedFileIds[0] || savedLinkIds[0]` and calls `IntentService.createIntent` with `sourceType: 'discovery_form'`. The created intents are returned in the HTTP response along with `filesProcessed`, `linksProcessed`, and `intentsGenerated` counters (lines 221‑254).

### 2.2 Background Queue (`../index/protocol/src/lib/queue/processor.ts:297-340`)

The queue worker handles `generate_intents` jobs for integrations and crawled sources:

- Fetches `existingIntents = IntentService.getUserIntents(userId)` to avoid duplicates.
- Chooses between `analyzeContent` (raw text blob) or `analyzeObjects` (structured objects) based on job payload.
- Requests `count = data.intentCount ?? (sourceType === 'link' ? 1 : 5)` intents.
- Every new payload is persisted through `IntentService.createIntent`, optionally tagging an index when `data.indexId` is provided.

## 3. Core Intent Inferrer (`../index/protocol/src/agents/core/intent_inferrer/index.ts`)

Key pieces we need to mirror from the actual implementation:

- **Prompt & schema** – `inferIntents` uses a long system prompt that enforces “self-contained, forward-looking intents” and validates output with Zod (`IntentSchema`).
- **LLM harness** – `traceableStructuredLlm("intent-inferrer", { content_length })` wraps `ChatOpenAI` (via OpenRouter presets) and pipes traces to Langfuse. Required env vars: `OPENROUTER_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
- **Timeouts** – Every call races the LLM against a 60s timeout; errors return `[]` so callers can degrade gracefully.
- **Content shapers**
  - `analyzeContent(content, itemCount, textInstruction?, existingIntents?, count?, timeoutMs?)` logs character counts, optionally threads the user guidance, calls `inferIntents`, and maps `{ intent, confidence }` → `{ payload, confidence }`.
  - `analyzeObjects(objects, ...)` concatenates `=== name ===\ncontent` blocks before delegating to `analyzeContent`.
  - `analyzeFolder(folderPath, fileIds, ...)` filters for supported extensions via `isFileExtensionSupported`, loads files in parallel with `loadFilesInParallel`, then calls `analyzeContent`.
- **Optional Unstructured client** – The module lazy-loads `UnstructuredClient` so integrations can normalize PDFs/Office docs when `UNSTRUCTURED_API_URL` is configured, though the discovery route currently bypasses it.

## 4. Intent Persistence (`../index/protocol/src/services/intent-service.ts`)

Whenever an intent payload is accepted (from discovery, integrations, or the queue):

1. `summarizeIntent` produces a short synopsis using the summarizer agent (falls back to original text when <200 chars).
2. `generateEmbedding` calls `text-embedding-3-large` (OpenAI) so intents can be indexed for semantic search; failures are logged but non-fatal.
3. The row is inserted into `intents`, optional `intent_indexes` rows are created, and `Events.Intent.onCreated` fires so indexers/brokers can react.

## 5. Frontend/API Contract (Real Behavior)

- The Next.js frontend talks to the protocol server through `frontend/src/lib/api.ts`, which always attaches `Authorization: Bearer <Privy token>` and JSON bodies. For discovery uploads it builds a `FormData` payload in `frontend/src/services/discover.ts`, again sending the same bearer token.
- Any MCP integration that wants to shell out to the HTTP API must therefore supply a Privy-compatible bearer token and hit the same `/discover/new` or `/discover/filter` endpoints—there’s no anonymous mode in production.

## 6. MCP HTTP Integration Plan

The MCP server will only interact with the protocol via its HTTP API, faithfully reproducing the frontend’s request patterns so every call flows through the existing LLM + persistence pipeline.

### 6.1 Authentication & configuration

- Add `PROTOCOL_API_URL` (points at the same deployment the frontend uses) and `PROTOCOL_API_TIMEOUT_MS` (optional) to the MCP `.env`.
- Implement the ChatGPT→Privy exchange so the MCP runtime can unwrap the Privy access token associated with the already-issued MCP bearer:
  1. Add a scope such as `privy:token:exchange` to `supportedScopes` and ensure the ChatGPT client requests it.
  2. Create a protected endpoint (e.g., `POST /privy/access-token`) that runs `authenticatePrivy`, locates the caller’s `AccessTokenRecord`, and returns the embedded `privyToken` plus its expiry metadata. Never log the raw token; only log a hash/last-4.
  3. Within the MCP tool, call this endpoint first, cache the Privy token alongside its `expiresAt`, and refresh it just-in-time using the same endpoint when the token is close to expiring.
- Because the MCP now holds user-specific Privy tokens, store them only in memory, wipe them on process restart, and redact them from telemetry.

### 6.2 Request assembly for `POST /discover/new`

1. Collect the incoming MCP fields (`fullInputText`, `rawText`, `conversationHistory`, `userMemory`). Drop blank entries.
2. Build a single payload string that mirrors what the frontend sends: label each section (`=== Conversation ===`, etc.) and prepend a `User instruction:` line when there is conversational guidance.
3. Create a `FormData` body with:
   - `payload`: the aggregated string.
   - `files`: omitted for now (future work can stream actual attachments).
4. Issue `fetch("${PROTOCOL_API_URL}/discover/new")` with method `POST`, headers `{ Authorization: 'Bearer <privyToken>' }`, and the FormData body. No `Content-Type` header is needed—`fetch` sets the multipart boundary automatically.
5. Treat non-2xx responses exactly like `frontend/src/lib/api.ts`: parse JSON when possible and throw an error that includes both HTTP status and server-provided message.

### 6.3 Handling `DiscoveryRequestResponse`

- Parse the JSON body and expect `{ success, intents, filesProcessed, linksProcessed, intentsGenerated }`.
- For MCP output:
  - `content`: summarize the intents (`1. payload (confidence N/A – produced upstream)`).
  - `structuredContent`: pass through the array of `intents` returned by the API so widgets can render them directly.
- If `intentsGenerated === 0`, return a polite “No intents detected” message but keep `success: true` to mirror server semantics.

### 6.4 Optional follow-up calls

- When the user wants to inspect discovery matches, call `POST /discover/filter` with the same Privy bearer token and JSON body shaped per `frontend/src/services/discover.ts`.
- Use the `DiscoverResponse` structure to populate any MCP widget/response elements (stakes, pagination, etc.).

## 7. Success Definition (Grounded in Real Code)

- Every MCP response comes from the protocol’s HTTP surface, ensuring the LLM pipeline, summarization, embeddings, and indexing all run server-side exactly as they do for the frontend.
- Authentication, rate limiting, and auditing remain centralized because each API call carries the user’s real Privy bearer obtained via the exchange endpoint.
- Failure modes match production: validation errors, crawl failures, and queue delays are surfaced verbatim from the API, keeping debugging simple.
- MCP logs record the outbound request metadata (endpoint, payload length, response time) and only the last 4 chars of Privy tokens so engineers can correlate them with protocol logs without leaking secrets.
