# Code Audit Report

**Date**: 2025-11-20
**Repo**: mcp2
**Purpose**: Comprehensive audit before cleanup - identify structure, patterns, duplication, and dead code

**Important**: This is Phase 0 - AUDIT ONLY. No code modifications made.

---

## 1. Structure Overview

### Core Directories

#### `src/server/auth/**` - DOES NOT EXIST
- No dedicated auth directory exists
- Auth logic is split between:
  - `src/server/middleware/` - Authentication middleware (JWT validation, Privy verification)
  - `src/server/oauth/` - OAuth 2.0 flow handlers

#### `src/server/oauth/**` - OAuth 2.0 Implementation
Contains 6 files implementing OAuth 2.0 with PKCE:
- **`authorize.ts`** - Authorization endpoint (`/authorize`, `/authorize/complete`) - handles user consent flow
- **`token.ts`** - Token endpoint (`/token`) - issues and refreshes access tokens
- **`wellknown.ts`** - Discovery endpoints (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`)
- **`storage.ts`** - In-memory storage for authorization codes, tokens, refresh tokens, and registered clients
- **`dcr.ts`** - Dynamic Client Registration (`/register`)
- **`logger.ts`** - Structured JSON logger for OAuth events

#### `src/server/middleware/**` - Request Processing
Contains 2 files:
- **`auth.ts`** - JWT token validation middleware (`validateToken`, `optionalAuth`)
  - Used by: `/mcp` endpoints, `/token/privy/access-token`
- **`privy.ts`** - Privy.io integration middleware
  - Contains: `verifyPrivyToken` (UNUSED), `callPrivyAPI` (internal only), `getPrivyUser` (UNUSED)
  - Only `verifyPrivyToken` is imported (but never called)

#### `src/server/mcp/**` - MCP Protocol Implementation
Contains 6 files implementing Model Context Protocol:
- **`server.ts`** - MCP server initialization and stdio transport
- **`tools.ts`** - Tool registration (`ListTools`) and handlers (`CallTool`)
  - Defines 5 tools: `get-items`, `perform-item-action`, `echo`, `extract_intent`, `discover_connections`
- **`resources.ts`** - Widget resource registration (`ListResources`, `ReadResource`)
  - Serves widget HTML with embedded JS/CSS URLs
- **`handlers.ts`** - HTTP endpoint for MCP over POST (`/mcp`)
- **`widgetConfig.ts`** - **CANONICAL** shared widget metadata (tools + resources)
- **`discoverConnections.ts`** - **CANONICAL** orchestrator for discover_connections flow

#### `src/server/protocol/**` - Protocol API Client
Contains 1 file:
- **`client.ts`** - **CANONICAL** typed client for Index Protocol API
  - Functions: `exchangePrivyToken`, `callDiscoverNew`, `callDiscoverFilter`, `callVibecheck`
  - All protocol calls should go through this module

#### `src/server/api/**` - Backend API Integration
Contains 1 file:
- **`backend.ts`** - Generic Protocol API wrapper with Privy user context
  - Functions: `callBackendAPI` (internal), `getItems` (used), `performAction` (used), `getUserProfile` (UNUSED)
  - Used by: `get-items` and `perform-item-action` tools

#### `src/server/` - Root Files
- **`index.ts`** - Main Express app with all route registrations
- **`config.ts`** - Environment configuration with test mode support

#### `src/widgets/**` - React Widget Bundles
Contains 4 widget implementations built with Vite:
- **`Echo/`** - Simple echo widget (tool: `echo`)
- **`ListView/`** - Interactive list view (tool: `get-items`)
- **`IntentDisplay/`** - Intent display with actions (tool: `extract_intent`)
- **`DiscoverConnections/`** - Connection discovery results (tool: `discover_connections`)
- **`shared/`** - Shared components (IntentList)
- **`hooks/`** - Shared hooks (useOpenAi, useWidgetState)
- **`vite.config.ts`** - Widget build configuration with 4 entry points

#### `src/client/**` - OAuth Consent UI
React SPA for OAuth authorization flow:
- **`src/routes/AuthorizePage.tsx`** - User consent screen with Privy integration
- **`src/routes/ErrorPage.tsx`** - OAuth error display
- **`src/components/`** - EMPTY directory (placeholder)
- **`src/hooks/`** - EMPTY directory (placeholder)
- **`src/assets/`** - Contains logo-black.svg
- **`vite.config.ts`** - Client build configuration

#### `tests/unit/**` - Unit Tests
- **`discoverConnections.test.ts`** - Tests for discover_connections orchestrator with mocked protocol client

#### `tests/e2e/auth/**` - E2E Auth Tests
Organized by concern:
- **`flows/`** - Happy path tests (4 files): OAuth flow, tool usage, refresh tokens, discover_connections
- **`errors/`** - Error handling tests (3 files): authorize, token, mcp endpoints
- **`security/`** - Security debt tests (2 files): introspection, privy exchange
- **`helpers/`** - Test infrastructure (8 files): server bootstrap, fake APIs, flow helpers, crypto utilities

---

## 2. Tools, Widgets, and Protocol

### Tools (from `src/server/mcp/tools.ts`)

| Tool Name | Description | Hits Protocol API? | Has Widget? | Widget URI |
|-----------|-------------|-------------------|-------------|------------|
| `get-items` | Get a list of items with optional filtering | ✅ Yes (via `backend.getItems`) | ✅ Yes | `ui://widget/list-view.html` |
| `perform-item-action` | Perform an action on a specific item | ✅ Yes (via `backend.performAction`) | ❌ No | N/A |
| `echo` | Simple echo tool that returns the input text | ❌ No | ✅ Yes | `ui://widget/echo.html` |
| `extract_intent` | Extract and structure user intents from conversation | ✅ Yes (via `protocol.callDiscoverNew`) | ✅ Yes | `ui://widget/intent-display.html` |
| `discover_connections` | Find potential connections to other Index users | ✅ Yes (via `discoverConnections` orchestrator) | ✅ Yes | `ui://widget/discover-connections.html` |

### Widgets (from `widgetConfig.ts` + `vite.config.ts` + `resources.ts`)

| Widget Key | File Name | URI | Vite Entry | Tool(s) | Description |
|------------|-----------|-----|------------|---------|-------------|
| `echo` | `echo` | `ui://widget/echo.html` | `src/Echo/index.tsx` | `echo` | Simple echo widget that displays text |
| `list-view` | `list-view` | `ui://widget/list-view.html` | `src/ListView/index.tsx` | `get-items` | Interactive list view with actions |
| `intent-display` | `intent-display` | `ui://widget/intent-display.html` | `src/IntentDisplay/index.tsx` | `extract_intent` | Displays extracted intents with archive/delete actions |
| `discover-connections` | `discover-connections` | `ui://widget/discover-connections.html` | `src/DiscoverConnections/index.tsx` | `discover_connections` | Displays discovered connections with synthesis summaries |

**Alignment**: ✅ Perfect 1:1 match between:
- Widget config keys
- Vite entry keys
- Widget bundle filenames
- Tool `_meta['openai/outputTemplate']` values

### Protocol Client Functions (from `src/server/protocol/client.ts`)

| Function | Purpose | Called By | Tool/Orchestrator |
|----------|---------|-----------|-------------------|
| `exchangePrivyToken` | Exchange OAuth token for Privy access token | `discoverConnections.ts` (line 100) | `discover_connections` orchestrator |
| `callDiscoverNew` | Extract intents from text via `/discover/new` | `tools.ts` (line 451), `discoverConnections.ts` (line 108) | `extract_intent` tool, `discover_connections` orchestrator |
| `callDiscoverFilter` | Find matching users via `/discover/filter` | `discoverConnections.ts` (line 127) | `discover_connections` orchestrator |
| `callVibecheck` | Generate synthesis for a user via `/synthesis/vibecheck` | `discoverConnections.ts` (line 231) | `discover_connections` orchestrator (via `runVibechecksWithPool`) |

**Pattern**: ✅ All protocol API calls go through typed client functions. No inline `fetch` to protocol endpoints found.

---

## 3. Patterns: Good vs Messy

### ✅ Good Patterns (Canonical - Treat as Reference)

#### 1. **Protocol Client + Orchestrator + Tool Handler** (`discover_connections`)
**Location**: `src/server/protocol/client.ts` + `src/server/mcp/discoverConnections.ts` + `src/server/mcp/tools.ts`

```
Tool Handler (tools.ts:handleDiscoverConnections)
  ↓ validates auth/input
  ↓ calls orchestrator
Orchestrator (discoverConnections.ts:discoverConnectionsFromText)
  ↓ exchanges token
  ↓ calls protocol client functions
Protocol Client (client.ts:exchangePrivyToken, callDiscoverNew, etc.)
  ↓ typed functions for each endpoint
  ↓ handles fetch + error handling + timeouts
```

**Why Good**:
- Clear separation of concerns
- Orchestrator is unit-testable with mocked client
- Protocol client is reusable across tools/orchestrators
- Type-safe end-to-end

**Applied To**:
- ✅ `discover_connections` tool (full pattern)
- ✅ `extract_intent` tool (partial - uses `callDiscoverNew` from protocol client, but no orchestrator yet)

**Not Applied To**:
- ⚠️ `get-items` / `perform-item-action` tools (use generic `backend.ts` instead of typed protocol client)

#### 2. **Shared Widget Config** (`widgetConfig.ts`)
**Location**: `src/server/mcp/widgetConfig.ts`

Single source of truth for widget metadata, referenced by:
- `tools.ts` - Tool `_meta` fields (OpenAI extensions)
- `resources.ts` - Resource registration and `ReadResource` handler
- `vite.config.ts` - Widget build entries (implicitly, via matching keys)

**Why Good**:
- Eliminates duplication between tools and resources
- Single place to update widget URIs, titles, descriptions
- Type-safe with `WidgetKey` union type

**Applied Everywhere**: ✅ All 4 widgets use this pattern

#### 3. **Test Infrastructure with Shared Context**
**Location**: `tests/e2e/auth/helpers/setup.ts` + test files

```
setup.ts (runs once via beforeAll):
  - Starts test server on random port
  - Starts fake Protocol API on random port
  - Stores server info in testContext
  - beforeEach: resets mocks

test files:
  - Import getTestContext() to get server URLs
  - Use flow-helpers for common test actions
```

**Why Good**:
- Tests are isolated but share infrastructure
- Random ports prevent conflicts
- Fake APIs enable deterministic testing without real Protocol API

#### 4. **OAuth Storage Abstraction**
**Location**: `src/server/oauth/storage.ts`

All OAuth state (codes, tokens, clients) goes through typed functions:
- `storeAuthorizationCode`, `getAuthorizationCode`, `markCodeAsUsed`
- `storeToken`, `getToken`, `deleteToken`
- `storeRefreshToken`, `getRefreshToken`, `deleteRefreshToken`
- `registerClient`, `getRegisteredClient`, `validateClientAndRedirectUri`

**Why Good**:
- Easy to swap in-memory storage for Redis/PostgreSQL
- Clear API surface
- PKCE validation encapsulated (`validatePKCE`)

### ⚠️ Messy/Inconsistent Patterns

#### 1. **Mixed Protocol API Integration Patterns**

**Problem**: Two different patterns for calling Protocol API:

**Pattern A** (Good - Used by `discover_connections`, `extract_intent`):
```typescript
// In tools.ts or orchestrator
import { callDiscoverNew } from '../protocol/client.js';
const data = await callDiscoverNew(privyToken, { text: payload });
```

**Pattern B** (Generic - Used by `get-items`, `perform-item-action`):
```typescript
// In tools.ts
import { getItems } from '../api/backend.js';
const items = await getItems(userId, filter);

// In backend.ts
export async function getItems(privyUserId: string, filter?: string) {
  return callBackendAPI(privyUserId, `/items?filter=...`, { method: 'GET' });
}
```

**Why Messy**:
- `backend.ts` is a generic wrapper without types for specific endpoints
- `get-items` tool calls `/items` endpoint, but we don't know if this is a real Protocol API endpoint or a placeholder
- If `/items` is not a real endpoint, `backend.ts` is vestigial code
- Mixing typed protocol client (`protocol/client.ts`) with generic wrapper (`api/backend.ts`) creates two APIs for the same concern

**Impact**:
- Low risk (both patterns work)
- Confusing for future developers ("which pattern should I use?")
- `backend.ts` may be dead code if `/items` and `/users/{id}` are not real Protocol API endpoints

**Files Involved**:
- `src/server/api/backend.ts` (generic wrapper)
- `src/server/mcp/tools.ts` (uses both patterns)

#### 2. **Unused Privy Middleware Exports**

**Problem**: `src/server/middleware/privy.ts` exports 3 functions:
- `verifyPrivyToken` - Imported in `index.ts` but never called (DEAD IMPORT)
- `callPrivyAPI` - Exported but only used internally by `getPrivyUser`
- `getPrivyUser` - Exported but never imported anywhere (DEAD EXPORT)

**Why Messy**:
- Public exports imply "this is part of the API surface"
- Dead exports suggest incomplete feature or abandoned approach
- `verifyPrivyToken` import in `index.ts` line 16 is misleading

**Files Involved**:
- `src/server/middleware/privy.ts`
- `src/server/index.ts` (dead import)

#### 3. **Empty Placeholder Directories in Client**

**Problem**: Two empty directories exist:
- `src/client/src/components/` - No files
- `src/client/src/hooks/` - No files

**Why Messy**:
- Suggests incomplete implementation or copy-paste from boilerplate
- No harm, but unnecessary directory noise

**Files Involved**:
- Empty directories in client structure

#### 4. **Inconsistent Error Handling Patterns**

**Problem**: Error handling varies across tools:

**Pattern A** (Minimal):
```typescript
// In tools.ts:handleGetItems
try {
  const items = await getItems(userId, filter);
  return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
} catch (error) {
  return {
    content: [{
      type: 'text',
      text: `Failed to fetch items: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }],
    isError: true,
  };
}
```

**Pattern B** (Detailed with logging):
```typescript
// In tools.ts:handleExtractIntent
try {
  // ... validation
  const privyToken = await exchangePrivyToken(oauthToken);
  const data = await callDiscoverNew(privyToken, { text: payload });
  return { content: [...], structuredContent: { intents: data.intents } };
} catch (error) {
  console.error('[extract_intent] Error:', error);
  return {
    content: [{
      type: 'text',
      text: `Failed to extract intents: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }],
    isError: true,
  };
}
```

**Why Messy**:
- Some tools log errors, some don't
- No consistent structure for tool error responses
- No distinction between validation errors vs API errors vs timeout errors

**Impact**:
- Low (errors are caught and returned)
- Makes debugging harder (inconsistent logging)

#### 5. **Duplicated Truncate Logic**

**Problem**: `tools.ts` has an inline `truncate` helper function (lines 415-417):

```typescript
function truncate(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}
```

This is only used in `handleExtractIntent` (lines 443-447).

**Why Messy**:
- One-use helper function at module scope
- Could be inlined at call site or extracted to shared utils if used elsewhere

**Impact**: Negligible

---

## 4. Candidate Dead Code

### 🔴 High Confidence - Safe to Remove

#### 1. **Unused Exports in `src/server/middleware/privy.ts`**

**Export**: `getPrivyUser`
- **Line**: 120
- **Why Unused**: Never imported anywhere in `src/**` or `tests/**`
- **Risk**: None - no dynamic access, not referenced in tests
- **Recommendation**: DELETE

**Export**: `callPrivyAPI`
- **Line**: 97
- **Why Unused**: Only called internally by `getPrivyUser` (which is also unused)
- **Risk**: None - once `getPrivyUser` is removed, this is also dead
- **Recommendation**: DELETE (after removing `getPrivyUser`)

#### 2. **Unused Export in `src/server/api/backend.ts`**

**Export**: `getUserProfile`
- **Line**: 76
- **Why Unused**: Never imported anywhere, described as "placeholder" in comment
- **Risk**: None - no dynamic access, not referenced in tests
- **Recommendation**: DELETE

#### 3. **Dead Import in `src/server/index.ts`**

**Import**: `import { verifyPrivyToken } from './middleware/privy.js';`
- **Line**: 16
- **Why Dead**: Imported but never called in the file
- **Risk**: None - just remove the import line
- **Recommendation**: DELETE IMPORT

#### 4. **Empty Directories in Client**

**Directories**:
- `src/client/src/components/` - Empty
- `src/client/src/hooks/` - Empty

**Why Unused**: No files, not referenced in code
**Risk**: None
**Recommendation**: DELETE directories (or keep if planned for future use)

#### 5. **Entire `unwanted/` Directory**

**Path**: `/Users/jahnik/index-network/mcp2/unwanted/`
**Contents**: 9 markdown files (~4500 lines total)
- AUTH_ANALYSIS.md (21 KB)
- AUTH_REVIEW.md (24 KB)
- CODEBASE_ARCHITECTURE.md (26 KB)
- CRITICAL_FINDINGS.md (8 KB)
- ECHO_WIDGET.md (4 KB)
- IMPLEMENTATION.md (15 KB)
- OAUTH_COMPARISON.md (32 KB)
- QUICK_COMPARISON.md (7 KB)
- README_COMPARISON.md (7 KB)
- crashed/ (empty subdirectory)

**Why Unused**: These appear to be old analysis/comparison documents, not referenced in code
**Risk**: Low - documentation only, but may contain historical context
**Recommendation**: MOVE to archive or DELETE (user decision - these may have value for historical reference)

### ⚠️ Medium Confidence - Review Needed

#### 6. **Generic Backend API Wrapper (`src/server/api/backend.ts`)**

**Exports**: `callBackendAPI`, `getItems`, `performAction`, `getUserProfile`

**Why Suspicious**:
- `getItems` and `performAction` are used by tools, BUT:
  - They call `/items` and `/items/{id}/actions` endpoints
  - These endpoints are NOT part of the Protocol API (which has `/discover/*` and `/synthesis/*`)
  - Comments say "placeholder - replace with actual Protocol API endpoints"
- If `/items` endpoints don't exist, these tools will fail at runtime
- `getUserProfile` is definitely unused

**Risk**: Medium
- If `/items` endpoints are real and working, keep `backend.ts`
- If `/items` endpoints are placeholders and tools never actually work, entire file could be removed
- Need to verify: Do `get-items` and `perform-item-action` tools actually work in production?

**Recommendation**:
- **Option A**: If `/items` endpoints don't exist, DELETE entire `backend.ts` and remove `get-items`/`perform-item-action` tools
- **Option B**: If endpoints exist, keep `backend.ts` but DELETE `getUserProfile` and consider adding types like `protocol/client.ts`

**Investigation Needed**: Check if Protocol API actually has `/items` endpoints

#### 7. **Inline Truncate Helper in `tools.ts`**

**Function**: `truncate` (lines 415-417)
- **Why Suspicious**: Module-scoped helper used only once in `handleExtractIntent`
- **Risk**: Low - just code bloat
- **Recommendation**: Inline at call site or extract to shared utils if used elsewhere

### ❌ Low Confidence - Keep for Now

#### 8. **`verifyPrivyToken` Function**

**File**: `src/server/middleware/privy.ts`
**Export**: `verifyPrivyToken`
- **Why Suspicious**: Imported in `index.ts` but never called
- **Why Keep**: Might be intended for future use as Express middleware for protecting certain routes with Privy auth
- **Risk**: Low - currently unused, but has clear purpose
- **Recommendation**: KEEP for now, but add TODO comment if not planned for immediate use

---

## 5. Cleanup Opportunities (Without Deletion)

### Local Cleanups (No Behavior Change)

#### 1. **Extract Shared Privy Token Exchange Timeout**

**Location**: `src/server/protocol/client.ts` line 111

Currently:
```typescript
signal: signal ?? AbortSignal.timeout(config.intentExtraction.privyTokenExchangeTimeoutMs)
```

**Opportunity**: Extract to named constant if this pattern is used elsewhere
**Benefit**: DRY, easier to find/change timeout value
**Risk**: None
**Priority**: Low

#### 2. **Consolidate Error Message Format in Tool Handlers**

**Location**: `src/server/mcp/tools.ts` - multiple tool handlers

Currently: Mix of patterns:
- Some include tool name in error message: `[extract_intent] Error:`
- Some don't: `Failed to fetch items:`
- Some log to console, some don't

**Opportunity**: Standardize to always include:
```typescript
console.error(`[${toolName}] Error:`, error);
return {
  content: [{ type: 'text', text: `Failed to ${action}: ${error.message}` }],
  isError: true,
};
```

**Benefit**: Consistent logging, easier debugging
**Risk**: None (output format unchanged)
**Priority**: Low

#### 3. **Extract Base URL Construction in `resources.ts`**

**Location**: `src/server/mcp/resources.ts` line 129

Currently:
```typescript
const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
```

**Opportunity**: Use `config.server.baseUrl` instead of reading env directly
**Benefit**: Consistent with rest of codebase
**Risk**: None
**Priority**: Low

#### 4. **Type Safety for Tool Names**

**Location**: `src/server/mcp/tools.ts` - tool handler dispatch

Currently: Tool names are strings, no type safety for tool handler dispatch

**Opportunity**: Create `ToolName` union type:
```typescript
type ToolName = 'get-items' | 'perform-item-action' | 'echo' | 'extract_intent' | 'discover_connections';
```

**Benefit**: Type-safe tool dispatching, autocomplete in IDE
**Risk**: None
**Priority**: Low

### Larger Refactors (Future - Not Now)

#### 1. **Migrate `get-items`/`perform-item-action` to Typed Protocol Client Pattern**

**If** `/items` endpoints are real Protocol API endpoints:
- Move `getItems` and `performAction` to `protocol/client.ts` with proper types
- Remove `backend.ts` or make it private utility
- Optionally create orchestrators if these tools become more complex

**Benefit**: Consistency with `discover_connections` pattern
**Risk**: Medium (need to verify endpoints exist and understand their schemas)
**Priority**: Low (current pattern works, just inconsistent)

#### 2. **Extract OAuth Storage to Separate Package/Module**

**Current**: `storage.ts` is tightly coupled to OAuth implementation

**Opportunity**: Make storage interface-based:
```typescript
interface OAuthStorage {
  storeAuthorizationCode(...): string;
  getAuthorizationCode(...): AuthorizationCode | undefined;
  // etc.
}

class InMemoryOAuthStorage implements OAuthStorage { ... }
```

**Benefit**: Easy to swap implementations (Redis, PostgreSQL, etc.)
**Risk**: High (requires changing many files)
**Priority**: Low (in-memory works fine for current needs)

---

## 6. Summary Statistics

### File Counts
- **Server Code**: 18 .ts files
- **Widget Code**: 13 .tsx files
- **Client Code**: 5 .tsx files
- **Test Code**: 18 .ts files
- **Total**: 54 files

### Import Graph Health
- ✅ **Zero circular dependencies** (not exhaustively checked, but no obvious cycles)
- ✅ **All protocol API calls** go through typed client or generic backend wrapper
- ⚠️ **3 unused exports** (high confidence: `getPrivyUser`, `getUserProfile`, + `callPrivyAPI` after cleanup)
- ⚠️ **1 dead import** (`verifyPrivyToken` in `index.ts`)

### Test Coverage
- ✅ **1 unit test file** covering orchestrator with mocks
- ✅ **10 e2e test files** covering OAuth flows, tool usage, errors, security
- ✅ **94 passing tests** (10 unit + 84 e2e)
- ✅ **Test infrastructure** is clean and reusable

### Widget Alignment
- ✅ **Perfect 1:1 match** between:
  - Widget config keys (widgetConfig.ts)
  - Vite entry keys (vite.config.ts)
  - Widget bundle filenames
  - Tool outputTemplate URIs

### Code Quality Patterns
- ✅ **2 canonical patterns** (protocol client + orchestrator, shared widget config)
- ⚠️ **5 messy patterns** (mixed protocol integration, unused middleware exports, empty dirs, inconsistent errors, one-use helpers)
- 🔴 **8 cleanup candidates** (5 high confidence, 2 medium, 1 low)

---

## 7. Next Steps (Phase 1 - Actual Deletions)

### Immediate Safe Deletions (Zero Risk)
1. DELETE `src/server/middleware/privy.ts::getPrivyUser` (unused export)
2. DELETE `src/server/middleware/privy.ts::callPrivyAPI` (internal-only, used by unused function)
3. DELETE `src/server/api/backend.ts::getUserProfile` (unused export)
4. DELETE import line in `src/server/index.ts` line 16 (`verifyPrivyToken`)
5. DELETE `src/client/src/components/` directory (empty)
6. DELETE `src/client/src/hooks/` directory (empty)

### Investigate Before Deletion (Medium Risk)
1. INVESTIGATE `src/server/api/backend.ts`:
   - Check if Protocol API has `/items` and `/items/{id}/actions` endpoints
   - If no: DELETE entire file and remove `get-items`/`perform-item-action` tools
   - If yes: Keep file but DELETE `getUserProfile`

2. INVESTIGATE `unwanted/` directory:
   - Review contents for historical value
   - Consider archiving rather than deleting
   - Or delete if confirmed to be obsolete analysis docs

### After Deletions
- Run `bun run test` to ensure all tests still pass
- Run `bun run type-check` to ensure no type errors
- Manually test OAuth flow and tool usage in ChatGPT

---

**End of Audit Report**
