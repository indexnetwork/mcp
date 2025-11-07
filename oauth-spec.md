# MCP OAuth Consent Page Rebuild – Implementation Spec

## Objective
Remove the runtime dependency on a CDN-hosted Privy browser SDK by compiling the OAuth consent experience through our existing Vite pipeline, allowing us to bundle Privy assets locally and serve a prebuilt HTML page from Express.

## Deliverables

1. **Vite Multi-Entry Build**
   - Extend `widgets/vite.config.ts` to emit both widget bundles and the new consent page bundle (HTML + JS).  
   - New entry point under `widgets/src/oauth-consent/` with its own React/TS app.

2. **Consent UI Implementation**
   - Build a React (or minimal TS) page that replicates current OTP flow, importing `@privy-io/react-auth` (or `@privy-io/js-sdk-core`) directly instead of loading from a CDN.
   - Read runtime context (state, redirect URI, etc.) from an injected script tag (same shape as current `AuthorizationPageContext`).

3. **Express Integration**
   - Update `/oauth/authorize` handler to serve the prebuilt consent HTML (e.g., via `res.sendFile` or cached `readFile`), replacing `authorizationPageHtml`.
   - Inject context by replacing a placeholder string in the HTML or by rendering a serialized context script before sending the response.

4. **Build & Dev Workflow**
   - Ensure `npm run dev` still runs a single watcher that covers both widgets and consent page (extended Vite watcher).
   - Production `npm run build` must produce both widget assets (`widgets/dist/widgets/…`) and the consent bundle (`widgets/dist/oauth/…`).

5. **Documentation / Config**
   - Remove CDN-specific env vars (`PRIVY_JS_SDK_VERSION`) from `.env` & docs.
  - Update README with new development and build steps.

## Key Code Changes

### Vite / Frontend
- `widgets/vite.config.ts`: configure multiple rollup inputs (widgets + consent). Separate output directories if necessary.
- `widgets/src/oauth-consent/` React app:
  - `main.tsx` bootstrapping the consent React root.
  - `App.tsx` implementing the current OTP flow UI with React components and state.
  - Hook/helper to parse `<script id="oauth-context">` for runtime data.
  - Use Privy’s React/browser SDK (`@privy-io/react-auth` or equivalent) via local npm dependency to send codes and verify OTPs.
  - Fetch to `/oauth/authorize/complete` remains unchanged (POST with `state` & `privyToken`).

-### Server
- `src/oauth.ts`:
  - Remove inline HTML string `authorizationPageHtml`.
  - Provide helper to serialize context as JSON for injection.
  - Maintain authorize/token/refresh logic untouched.
- `src/server.ts`:
  - On `/oauth/authorize`, read the built HTML template (cache in memory) and replace the `__OAUTH_CONTEXT__` placeholder inside the bundled `<script id="oauth-context">` tag with serialized context JSON.
  - Ensure static assets (JS/CSS) for consent bundle are served via existing `app.use('/widgets', express.static(...))` or add new static route.
  - Add a dedicated static route (e.g., `app.use('/oauth-assets', express.static(distRoot, { cacheControl: false }))`) that serves the consent bundle output directory without caching (can be revisited later if needed).

### Build Config
- `package.json` & `widgets/package.json`: add necessary dependencies (`@privy-io/react-auth`, etc.), adjust scripts if required.
- `env.example` / `.env`: remove now-unused CDN version entry.
- Consider adding a build verification step to confirm `widgets/dist/oauth/index.html` exists post-build (e.g., part of `npm run build`).

## Open Questions

1. **Testing**
   - Determine how to regression-test the new consent flow (e.g., Cypress, Playwright, or manual checklist).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Build output path conflicts with existing widget assets | Separate output directories (`widgets/dist/widgets/*`, `widgets/dist/oauth/*`). |
| Runtime fails to inject context after bundling | Add log assertions in `/oauth/authorize` to ensure placeholder replaced; fallback to JSON fetch strategy if necessary. |
| Privy React SDK requires additional configuration (redirects, providers) | Review Privy docs before coding; wrap app in required providers during Vite build. |
| Longer build/watch times | Measure after implementation; if problematic, consider splitting into a second watcher. |

## Success Criteria

- OAuth consent page loads without CDN calls, uses locally bundled JS, and completes the Privy OTP flow successfully.
- `npm run dev` displays hot reload for both widgets and consent UI.
- `npm run build` outputs both widget bundles and consent assets consumed by the server.
- Docs & env templates reflect the new workflow; no references to CDN-loaded Privy scripts remain.
