# Discover Filter Tool Spec

## Objective
Implement the `discover_filter` MCP tool so it can both (a) proxy requests from ChatGPT (or any MCP client) directly to the Index Protocol's `POST /discover/filter` endpoint and (b) optionally chain an intent-generation pass before filtering. When callers provide fresh conversation input instead of existing intent IDs, the tool must invoke the existing intent extraction workflow, persist any resulting intents, and immediately run `/discover/filter` using the newly created IDs. After producing discovery results, the tool must call the VibeCheck synthesis endpoint for every returned candidate so each connection includes a human-friendly description.

## References
- Backend route: `../index/protocol/src/routes/discover.ts` (`router.post('/discover/filter', …)`)
- Query engine: `../index/protocol/src/lib/discover.ts`
- Frontend client: `../index/frontend/src/services/discover.ts`
- MCP server entry point: `src/server.ts`

## Tool Contract

### Name
`discover_filter`

### Purpose
Return discovery matches for the authenticated MCP user based on intent, user, index, or source filters.

### MCP Input Schema
```ts
{
  intentIds?: string[];          // UUID strings
  userIds?: string[];            // UUID strings
  indexIds?: string[];           // UUID strings
  sources?: Array<{
    type: 'file' | 'integration' | 'link' | 'discovery_form';
    id: string;                  // UUID
  }>;
  excludeDiscovered?: boolean;   // defaults true server-side
  page?: number;                 // >= 1, default 1
  limit?: number;                // 1–100, default 50
  intentInput?: {                // optional chaining payload; ignored if intentIds present
    fullInputText: string;
    rawText?: string;
    conversationHistory?: string;
    userMemory?: string;
  };
  vibecheck?: {                  // optional tuning for mandatory synthesis
    characterLimit?: number;     // forwarded to /synthesis/vibecheck options
    concurrency?: number;        // cap for parallel synth calls (default 2, max 5)
  };
}
```

Validation should mirror the Express validator rules to give early feedback before making the network call. Reuse/extend the existing Zod dependency already in `src/server.ts`. Additional checks:
- Enforce that either `intentIds` or `intentInput.fullInputText` must be supplied (tool cannot run with neither).
- When both are provided, `intentIds` wins and chaining is skipped.
- Ensure `characterLimit` is a positive integer when provided and `concurrency` stays within 1–5.

### MCP Output Schema
The tool should forward the API response verbatim where possible:
```ts
{
  results: Array<{
    user: {
      id: string;
      name: string;
      email: string | null;
      avatar: string | null;
      intro: string | null;
    };
    totalStake: number;
    intents: Array<{
      intent: {
        id: string;
        payload: string;
        summary?: string | null;
        createdAt: string; // convert Date → ISO
      };
      totalStake: number;
      reasonings: string[];
    }>;
  }>;
  pagination: { page: number; limit: number; hasNext: boolean; hasPrev: boolean; };
  filters: {
    intentIds: string[] | null;
    userIds: string[] | null;
    indexIds: string[] | null;
    sources: Array<{ type: string; id: string }> | null;
    excludeDiscovered?: boolean;
  };
  vibechecks: Array<{
    targetUserId: string;
    synthesis: string;          // empty string if generation failed
    characterLimit?: number;
  }>;
}
```

`content` should include a concise textual summary (e.g., "Generated 2 intents, found 3 matches, VibeCheck summaries attached for all 3"). The summary must mention that synthesis ran (or failed) since it is always attempted and should note that detailed cards follow. The full JSON payload goes into `structuredContent` so downstream widgets (including the ChatGPT card widget below) can render rich cards.

### Card Rendering Contract
- Each discovery result must map to a "card" object containing `header` (name, role, badges), `body` (key stats, VibeCheck paragraph), and `actions` (suggested next steps). Store these under `structuredContent.cards` mirroring the ordering of `results`.
- The tool should also emit lightweight Markdown/HTML snippets per card (e.g., `<section>` wrappers) to ease chat rendering.
- Error states (e.g., missing VibeCheck) should appear as tags/badges within their respective cards instead of separate error blocks.

### ChatGPT Widget Integration
- Define a dedicated widget template (e.g., `index-discover` at `ui://widget/index-discover.html`) within `widgets/dist` that can accept a JSON payload of cards and render them with consistent styling (header, vibe summary, CTA buttons).
- Register the widget resource alongside `index-echo` in `src/server.ts` so it can be referenced via `openai/outputTemplate` and `openai.com/widget` annotations.
- When returning from `discover_filter`, add the following metadata to the tool response:
  - `_meta["openai/widgetAccessible"] = true`
  - `_meta["openai/resultCanProduceWidget"] = true`
  - `_meta["openai/outputTemplate"] = indexDiscoverWidget.templateUri`
  - `_meta["openai/toolInvocation/invoking"]` / `_meta["openai/toolInvocation/invoked"]` strings describing card rendering
  - `_meta["openai.com/widget"] = indexDiscoverEmbeddedResource`
- The widget should display:
  1. Summary banner (intents generated, matches found, pagination info)
  2. Card grid/stack derived from `structuredContent.cards`
  3. Inline VibeCheck text with avatar/badge
  4. Footer actions (e.g., "Connect", "Save", "Next Page") that map to hints or follow-up tool calls
- Ensure the widget gracefully degrades (e.g., shows plain text) when ChatGPT clients do not yet support custom widgets.

### Widget Asset Requirements
- Source lives under `widgets/src/discover` (or similar) and builds into `widgets/dist/widgets/index-discover.html` alongside hashed CSS/JS.
- Document expected input props (`cards`, `summary`, `pagination`, `vibechecks`) so future changes don’t break MCP responses.
- Ensure build pipeline (`yarn build:widgets` or equivalent) includes this template; set cache headers to `max-age=31536000, immutable` for fingerprinted assets.
- Version the widget template URI (`index-discover@v1`) so clients can invalidate caches when markup changes.

### Pagination & Navigation
- Surface `pagination.hasNext/hasPrev` both in the textual summary and as widget CTA buttons (`Next page`, `Previous page`).
- CTA clicks should invoke the same tool with incremented/decremented `page` values; include `pageHint` fields in `structuredContent` describing valid follow-up commands.
- When no more pages exist, disable/remove the corresponding CTA to avoid confusing users.

### Rate Limiting & Retries
- Throttle `/synthesis/vibecheck` calls using the `concurrency` option plus a short delay (`50-100ms`) between batches.
- On transient failures (5xx or network), retry up to 2 times with exponential backoff (e.g., 250ms, 500ms). Log final failure if retries exhausted.
- Respect backend rate limits by propagating `Retry-After` headers into server logs/metrics.

### Telemetry & Logging
- Emit structured logs per invocation: `{ tool: 'discover_filter', intentsResolved, matches, vibecheckSuccess, vibecheckFailures, filtersSummary }`.
- Capture latency metrics separately for `discover/filter` and each `synthesis/vibecheck` batch to monitor hotspots.
- Consider lightweight tracing (request IDs) so protocol engineers can correlate MCP calls with backend logs.

### Privacy & PII Handling
- Cards may include sensitive intent payloads or vibe descriptions; ensure summaries truncate or redact PHI/PII according to policy.
- Widget assets must avoid writing to localStorage or emitting analytics events unless explicitly consented.
- When logging, avoid dumping full payloads—log IDs/counts only.

### Testing & QA
- Extend unit tests to cover widget metadata (`_meta` fields) and `structuredContent.cards` generation.
- Add snapshot/storybook coverage for the new widget to guard against regressions in card layout.
- Write integration tests (or manual checklist) for chained intent generation + pagination + mandatory vibechecks.

### Fallback UX
- If widgets aren’t supported by the client, ensure `content` includes Markdown card representations (header, bullets, italicized vibe summary) so users still see structured info.
- Document detection heuristics (e.g., absence of `openai/widgetAccessible`) and instruct clients on how to gracefully degrade.

## Authentication & Authorization
`/discover/filter` requires a Privy-authenticated bearer token. The MCP server already authenticates requests, so reuse `extra?.authInfo?.token` (same as `extract_intent`). Steps:
1. Assert `extra?.authInfo?.token` exists, else throw.
2. Exchange chat token for Privy token via existing `exchangePrivyToken` helper (ensures short-lived bearer scoped for `/discover`).
3. Use the Privy token as `Authorization: Bearer <token>` when calling the protocol API.

## Network Call
- Target URL: `${ensureProtocolApiBaseUrl()}/discover/filter`
- Method: `POST`
- Headers: `Authorization`, `Content-Type: application/json`, optional `Accept: application/json`
- Body: JSON-serialized tool input after stripping `undefined` values.
- Timeout: reuse `protocolApiTimeoutMs` constant (same as discovery submission) via `fetchWithTimeout` to keep behavior consistent.

### Chained Intent Generation Flow
1. Determine whether `intentIds` array has at least one entry. If so, skip chaining and proceed to `/discover/filter`.
2. If `intentIds` is absent/empty but `intentInput` exists, call the existing helpers used by `extract_intent`:
   - Build the combined payload via `buildIntentPayload`.
   - Exchange the auth token and call `submitDiscoveryRequest` to create intents (mirrors `/discover/new`).
   - Collect the `id` values from the response (`intents` array). If none are returned, surface a descriptive error explaining that no intents were derived from the provided input.
3. Use the gathered intent IDs as the `intentIds` field when calling `/discover/filter`.
4. Include the generated intents in `structuredContent` (e.g., `structuredContent.generatedIntents`) so clients can render both the new intents and the discovery matches in one response.
5. Ensure chaining happens sequentially within the same request context to avoid multi-call race conditions.

### VibeCheck Integration Flow
1. Always run synthesis for every discovery candidate returned.
2. For each candidate (skip if candidate ID equals authenticated user ID), call `${ensureProtocolApiBaseUrl()}/synthesis/vibecheck` with payload `{ targetUserId, intentIds: resolvedIntentIds, indexIds: suppliedIndexIds, options: { characterLimit } }`.
3. Execute calls sequentially or with a configurable concurrency cap (`vibecheck.concurrency ?? 2`, max 5) to prevent overload.
4. Collect every response—success or failure—into the `vibechecks` array aligned with the `results` ordering.
5. Reference: `../index/protocol/src/routes/synthesis.ts` and `../index/protocol/src/lib/synthesis.ts` show the request/response contracts.

### Success Handling
1. Parse JSON via `parseJsonIfPresent`.
2. On 2xx without JSON, throw descriptive error.
3. Cast payload to the interface above (consider a Zod schema for runtime validation to avoid silent drift).
4. Format textual summary: include counts, first few matched users, whether chaining was used, confirm vibechecks were generated for all matches (or note failures), and mention pagination state.
5. Return `{ content: [{ type: 'text', text: summary }], structuredContent: payload }`.

### Error Handling
- Non-2xx → bubble up backend `error` field if present, otherwise `response.statusText`.
- Validation errors detected before the network call should return `isError: true` with the aggregated Zod messages.
- Timeout or network failure → `discover_filter` should surface "Discover filter request timed out after X ms".
- Log (server-side `console.error`) contextual data: filter keys (not entire payload), HTTP status, response body snippet (<=500 chars).
- VibeCheck failures should not fail the whole tool: include a warning note in the textual summary (e.g., "VibeCheck unavailable for 1 candidate") and log details, but still return an entry with empty synthesis text for that candidate.

## Rate & Payload Limits
- Filters array sizes should be capped (e.g., max 20 IDs per field) to keep payloads reasonable and protect backend.
- Respect existing backend limit of 1–100 results per page. Default to 50 if client omits `limit`.
- Consider debouncing or caching if tool is triggered repeatedly with the same filters during one session (future enhancement).

## Testing & Validation Plan
- Unit-test a helper that maps MCP input → API payload, ensuring undefined fields are removed and defaults applied.
- Mock `fetchWithTimeout` to simulate success, 4xx validation error, and timeout paths for both `/discover/filter` and `/synthesis/vibecheck`.
- Manual end-to-end test using `curl` with a real Privy token (post-MVP) to confirm parity with the frontend.

## Rollout Steps
1. Replace placeholder implementation in `src/server.ts` with the real handler per this spec.
2. Document tool usage in `intent-spec.md` or a new README section for MCP clients.
3. Coordinate with protocol team before production deploy to ensure `/discover/filter` is stable and has monitoring for MCP traffic.

## Future Enhancements
- Support streaming responses once `/discover/filter` can stream partial matches.
- Add optional `includeDebug` flag gated behind a feature switch for internal use (surface raw stakes, SQL explain, etc.).
- Expand chained flows to support multi-step enrichment (e.g., auto-uploading referenced files or crawling links before intent extraction).
- Offer configurable strategies for prioritizing synthesis concurrency (e.g., prefer highest stake first) even though all candidates receive vibechecks.
