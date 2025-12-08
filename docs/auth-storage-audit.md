# Auth/Storage Layer Audit

This document provides a detailed audit of the current auth/storage architecture in mcp2, identifying what must be persisted for ChatGPT connections to survive server restarts.

## 0. Auth-Related Code Files

### Core Storage
- **`src/server/oauth/storage.ts`** — All in-memory storage for OAuth state (codes, tokens, clients, refresh tokens)

### OAuth Endpoints
- **`src/server/oauth/authorize.ts`** — `/authorize`, `/authorize/complete` (authorization code creation)
- **`src/server/oauth/token.ts`** — `/token` (access/refresh token issuance), `/token/privy/access-token` (privy token exchange)
- **`src/server/oauth/dcr.ts`** — `/register` (dynamic client registration)
- **`src/server/oauth/wellknown.ts`** — `/.well-known/*` (OAuth discovery metadata)

### Auth Middleware
- **`src/server/middleware/auth.ts`** — `validateToken()` middleware for `/mcp` endpoints (JWT verification)
- **`src/server/middleware/privy.ts`** — `verifyPrivyToken()` middleware (Privy SDK token verification)

### Configuration
- **`src/server/config.ts`** — JWT keys, issuer, audience, token lifetimes

### Consumers
- **`src/server/mcp/handlers.ts`** — Uses `validateToken(['read'])` to protect `/mcp`
- **`src/server/protocol/client.ts`** — `exchangePrivyToken()` calls `/token/privy/access-token`

---

## 1. In-Memory Storage Maps

All storage is in `src/server/oauth/storage.ts`:

```typescript
// Line 66-69
const authorizationCodes = new Map<string, AuthorizationCode>();
const registeredClients = new Map<string, RegisteredClient>();
const tokens = new Map<string, TokenData>();
const refreshTokens = new Map<string, RefreshTokenData>();
```

### 1.1 Authorization Codes (`authorizationCodes`)

**Type**: `Map<string, AuthorizationCode>`

**Key**: 64-character hex string (32 random bytes)

**Value**:
```typescript
interface AuthorizationCode {
  code: string;
  clientId: string;
  privyUserId: string;       // Privy DID (e.g., "did:privy:...")
  privyToken: string;        // The actual Privy JWT for later exchange
  privyClaims?: PrivyClaims; // Verified claims from Privy
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  expiresAt: number;         // 30 seconds from creation
  used: boolean;
}
```

**Lifecycle**:
- **Created**: In `POST /authorize/complete` or `POST /authorize` (after Privy token verification)
- **Consumed**: In `POST /token` (authorization_code grant) — deleted after single use
- **Expiry**: 30 seconds (checked on lookup, cleaned up every 5 minutes)

**Restart Impact**: **Minimal** — Auth codes are short-lived (30s). Any in-flight auth flow would fail, but user can retry.

### 1.2 Registered Clients (`registeredClients`)

**Type**: `Map<string, RegisteredClient>`

**Key**: `clientId` string (e.g., `"chatgpt-connector"` or `"client_<uuid>"`)

**Value**:
```typescript
interface RegisteredClient {
  clientId: string;
  clientSecret?: string;     // Not used (PKCE flow)
  redirectUris: string[];
  registeredAt: number;
}
```

**Lifecycle**:
- **Static client** (`chatgpt-connector`): Created on module load via `bootstrapStaticClients()` at line 71-85
- **Dynamic clients**: Created via `POST /register` (DCR endpoint)

**Restart Impact**: **None for ChatGPT** — The static client is re-bootstrapped on startup. Dynamic clients are lost but ChatGPT uses the static one.

### 1.3 Access Tokens (`tokens`)

**Type**: `Map<string, TokenData>`

**Key**: The full JWT access token string

**Value**:
```typescript
interface TokenData {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;   // Stored for /token/privy/access-token exchange
  scopes: string[];
  expiresAt: number;    // 1 hour from creation
}
```

**Lifecycle**:
- **Created**: In `POST /token` (both authorization_code and refresh_token grants)
- **Lookup**: In `POST /token/privy/access-token` to find the associated Privy token
- **Expiry**: 1 hour (cleaned up every 5 minutes)

**Restart Impact**: **CRITICAL for Privy exchange** — After restart, `/token/privy/access-token` fails with 404 because the token isn't in the map, even though the JWT is cryptographically valid.

### 1.4 Refresh Tokens (`refreshTokens`)

**Type**: `Map<string, RefreshTokenData>`

**Key**: 96-character hex string (48 random bytes)

**Value**:
```typescript
interface RefreshTokenData {
  token: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;   // Carried forward through refresh cycles
  scopes: string[];
  expiresAt: number;    // 30 days from creation
}
```

**Lifecycle**:
- **Created**: In `POST /token` (both grants)
- **Rotated**: In refresh flow — old token deleted, new token created
- **Expiry**: 30 days (cleaned up every 5 minutes)

**Restart Impact**: **CRITICAL** — After restart, refresh tokens become invalid. ChatGPT cannot refresh its access token and must re-auth.

---

## 2. Auth Flow Analysis

### 2.1 Authorization Code Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. ChatGPT → GET /authorize?client_id=chatgpt-connector&...           │
│     - Validates client_id in registeredClients                          │
│     - Returns auth UI (or passes through to React)                      │
├─────────────────────────────────────────────────────────────────────────┤
│  2. User authenticates with Privy (frontend)                            │
│     - Frontend gets privy_token from Privy SDK                          │
├─────────────────────────────────────────────────────────────────────────┤
│  3. Frontend → POST /authorize/complete                                 │
│     Body: { privy_token, client_id, redirect_uri, code_challenge, ... } │
│                                                                         │
│     Server:                                                             │
│     a) Verifies privy_token with Privy SDK → privyClaims                │
│     b) Validates client_id in registeredClients                         │
│     c) Creates authCode = storeAuthorizationCode({                      │
│          clientId, privyUserId, privyToken, privyClaims,                │
│          scopes, codeChallenge, redirectUri, expiresAt                  │
│        })                                                               │
│     d) Returns { code: authCode, redirect_uri }                         │
├─────────────────────────────────────────────────────────────────────────┤
│  4. ChatGPT → POST /token                                               │
│     Body: { grant_type: "authorization_code", code, code_verifier, ... }│
│                                                                         │
│     Server:                                                             │
│     a) Looks up code in authorizationCodes → authCode                   │
│     b) Validates: not used, not expired, client_id matches, PKCE valid  │
│     c) Deletes the auth code (single use)                               │
│     d) Issues JWT access token (signed, contains sub=privyUserId)       │
│     e) Stores in tokens: { accessToken, clientId, privyUserId,          │
│                            privyToken, scopes, expiresAt }              │
│     f) Creates refresh token in refreshTokens: { token, clientId,       │
│                            privyUserId, privyToken, scopes, expiresAt } │
│     g) Returns { access_token, refresh_token, expires_in, scope }       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Refresh Token Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ChatGPT → POST /token                                                  │
│  Body: { grant_type: "refresh_token", refresh_token, client_id }        │
│                                                                         │
│  Server:                                                                │
│  a) Looks up refresh_token in refreshTokens → storedRefreshToken        │
│  b) Validates: client_id matches, not expired                           │
│  c) Deletes old refresh token (rotation)                                │
│  d) Creates new refresh token in refreshTokens (same privyToken!)       │
│  e) Issues new JWT access token                                         │
│  f) Stores in tokens (same privyToken!)                                 │
│  g) Returns { access_token, refresh_token, expires_in, scope }          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key observation**: The original `privyToken` is **carried forward** through all refresh cycles. It's stored when the auth code is created and copied to each new refresh/access token entry.

### 2.3 Privy Token Exchange Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  MCP Tool → POST /token/privy/access-token                              │
│  Headers: { Authorization: "Bearer <access_token>" }                    │
│                                                                         │
│  Server (in token.ts lines 326-368):                                    │
│  a) validateToken(['privy:token:exchange']) middleware:                 │
│     - Extracts Bearer token                                             │
│     - Verifies JWT signature, issuer, audience, expiry (crypto only!)   │
│     - Checks scope includes 'privy:token:exchange'                      │
│     - Attaches req.auth = { token, decoded, userId, scopes }            │
│                                                                         │
│  b) Handler:                                                            │
│     - Gets oauthToken = req.auth.token                                  │
│     - Looks up in tokens Map: tokenData = getToken(oauthToken)          │
│     - If NOT FOUND → 404 "token_not_found" ← THIS BREAKS ON RESTART     │
│     - Returns { privyAccessToken, expiresAt, userId, scope }            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. `/mcp` Auth Usage

**File**: `src/server/mcp/handlers.ts`

```typescript
// Line 17
mcpRouter.post('/', validateToken(['read']), async (req, res) => { ... });
```

### How `validateToken()` Works (middleware/auth.ts)

1. Extracts `Bearer <token>` from `Authorization` header
2. **Verifies JWT cryptographically**:
   - Algorithm: RS256
   - Issuer: `config.jwt.issuer` (SERVER_BASE_URL)
   - Audience: `config.server.baseUrl`
   - Expiration: checks `exp` claim
3. Extracts `scope` from JWT payload
4. Checks required scopes (e.g., `['read']`)
5. Attaches `req.auth = { token, decoded, userId, scopes }`

### Does `/mcp` Depend on In-Memory Storage?

**No.** The `validateToken()` middleware **only** does cryptographic JWT verification. It does **not** consult any in-memory store for revocation or metadata.

**After restart**:
- `/mcp` calls will **succeed** as long as the JWT is cryptographically valid and not expired
- The JWT contains everything needed: `sub`, `scope`, `aud`, `exp`

**However**: If the MCP tool calls `/token/privy/access-token` (which `extract_intent` and `discover_connections` do), that will fail because the token isn't in the `tokens` Map.

---

## 4. Test Coverage

### E2E Tests (`tests/e2e/auth/`)

| Test File | Flows Tested | Storage Dependencies |
|-----------|--------------|----------------------|
| `flows/flow_connect_app.spec.ts` | Full OAuth flow | authCodes, tokens, refreshTokens |
| `flows/flow_refresh_tokens.spec.ts` | Refresh token rotation | refreshTokens, tokens |
| `flows/flow_tool_usage.spec.ts` | MCP tool calls | tokens (for privy exchange) |
| `flows/flow_discover_connections.spec.ts` | discover_connections tool | tokens (for privy exchange) |
| `errors/errors_authorize.spec.ts` | Auth code errors | authCodes |
| `errors/errors_token.spec.ts` | Token endpoint errors | authCodes, refreshTokens |
| `errors/errors_mcp.spec.ts` | MCP auth errors | (JWT only) |
| `security/security_privy_exchange.spec.ts` | Privy token handling | tokens |
| `security/security_introspection.spec.ts` | Token introspection | (JWT only) |

### Test Assumptions About In-Memory Stores

1. **`flow_refresh_tokens.spec.ts`**:
   - Assumes refresh tokens can be looked up immediately after creation
   - Tests rotation: old token becomes invalid after use
   - **No restart simulation** — all tests run in a single server lifecycle

2. **`security_privy_exchange.spec.ts`**:
   - Documents that Privy tokens are stored in-memory
   - Tests that same Privy token is preserved through refresh cycles
   - **Explicitly notes this as security debt** (stale tokens may be returned)

3. **General pattern**:
   - Each test file uses `beforeAll` to start servers once per worker
   - `beforeEach` resets fake Privy state but **not** the real storage Maps
   - No tests simulate or verify behavior across server restarts

### Unit Tests (`tests/unit/`)

Only one file: `tests/unit/discoverConnections.test.ts`
- Mocks the protocol client functions
- Does not test auth/storage layer directly

---

## 5. Current Architecture Summary

### In-Memory Stores

| Store | Module | Type | What It Holds | Created When | Consumed When | Must Persist? |
|-------|--------|------|---------------|--------------|---------------|---------------|
| `authorizationCodes` | storage.ts | `Map<string, AuthorizationCode>` | Code, client, user, privy token, PKCE, expiry | POST /authorize/complete | POST /token (auth_code grant) | No (30s lifetime) |
| `registeredClients` | storage.ts | `Map<string, RegisteredClient>` | client_id, redirect URIs | Module load (static) or POST /register | GET/POST /authorize | No (static re-bootstraps) |
| `tokens` | storage.ts | `Map<string, TokenData>` | Access token, client, user, **privy token**, scopes, expiry | POST /token | POST /token/privy/access-token | **YES** |
| `refreshTokens` | storage.ts | `Map<string, RefreshTokenData>` | Refresh token, client, user, **privy token**, scopes, expiry | POST /token | POST /token (refresh grant) | **YES** |

### What Breaks on Restart

1. **Refresh tokens invalid** → ChatGPT gets `invalid_grant` when trying to refresh
2. **Privy token exchange fails** → MCP tools get 404 from `/token/privy/access-token`
3. **Access tokens still work for `/mcp`** → JWT verification doesn't need storage

### The Privy Token Chain

```
   privy_token (from frontend)
        │
        ▼
   authorizationCodes[code].privyToken  ← 30s lifetime
        │
        ▼ (consumed on token exchange)
   tokens[accessToken].privyToken        ← 1 hour lifetime
   refreshTokens[refreshToken].privyToken ← 30 days lifetime
        │
        ▼ (on refresh)
   tokens[newAccessToken].privyToken     ← same value, new entry
   refreshTokens[newRefreshToken].privyToken ← same value, new entry
```

The original Privy token is copied at each step. It's **never refreshed** — this is documented as security debt in `security_privy_exchange.spec.ts`.

---

## 6. What Must Be Persisted

### Minimum Set for "ChatGPT keeps working across restarts"

1. **Refresh Tokens** (`refreshTokens` Map)
   - Key: refresh token string
   - Value: clientId, privyUserId, **privyToken**, scopes, expiresAt

2. **Access Tokens** (`tokens` Map) — **specifically for Privy exchange**
   - Key: access token JWT string
   - Value: clientId, privyUserId, **privyToken**, scopes, expiresAt
   - Note: The JWT itself is self-validating for `/mcp`, but we need the Map entry for `/token/privy/access-token`

### Nice to Have

3. **Dynamic Clients** (`registeredClients` minus static)
   - Only if you want DCR clients to survive restarts
   - ChatGPT uses static client, so not critical

### Not Needed

4. **Authorization Codes** — 30-second lifetime, not worth persisting
5. **Static Client** — Re-bootstrapped on startup

---

## 7. Complicating Factors for Postgres Migration

### 7.1 Module-Level Singletons

All Maps are module-level variables in `storage.ts`:
```typescript
const authorizationCodes = new Map<...>();
const registeredClients = new Map<...>();
const tokens = new Map<...>();
const refreshTokens = new Map<...>();
```

This means:
- No dependency injection
- All consumers import functions directly: `import { getToken, storeToken } from './storage.js'`
- Can't easily swap implementations

### 7.2 Cleanup Timer

```typescript
// Line 88-110
setInterval(() => {
  // Clean up expired entries
}, 5 * 60 * 1000);
```

This is baked into the module. A Postgres implementation would need its own cleanup strategy (TTL columns, scheduled jobs, etc.).

### 7.3 Key Structure

- **Access tokens**: Full JWT string (~500 chars) is used as key
- **Refresh tokens**: 96-char hex string
- **Auth codes**: 64-char hex string

The JWT-as-key is unusual. Most systems use a token ID claim (`jti`) as the key. Current approach works but means:
- Large keys in the DB
- Can't lookup by token ID alone

### 7.4 Privy Token Storage

The `privyToken` field is stored verbatim in multiple places:
- Authorization code entry
- Access token entry
- Refresh token entry (and carried forward on rotation)

This is essentially a foreign credential stored alongside OAuth state. Consider whether it should:
- Live in its own table/store
- Be encrypted at rest
- Have its own expiry tracking

---

## 8. Proposed Abstraction Boundaries

### 8.1 Repository Interfaces

Create interfaces in `src/server/oauth/repositories/` or `src/server/storage/`:

```typescript
// AuthorizationCodeRepository
interface AuthorizationCodeRepository {
  create(data: Omit<AuthorizationCode, 'code' | 'used'>): Promise<string>;
  findByCode(code: string): Promise<AuthorizationCode | null>;
  markAsUsed(code: string): Promise<void>;
  delete(code: string): Promise<void>;
}

// RefreshTokenRepository
interface RefreshTokenRepository {
  create(data: Omit<RefreshTokenData, 'token'>): Promise<string>;
  findByToken(token: string): Promise<RefreshTokenData | null>;
  delete(token: string): Promise<void>;
  // Note: No expiry cleanup method — handled by DB TTL or cron
}

// AccessTokenRepository (for Privy exchange)
interface AccessTokenRepository {
  store(accessToken: string, data: Omit<TokenData, 'accessToken'>): Promise<void>;
  findByToken(accessToken: string): Promise<TokenData | null>;
  delete(accessToken: string): Promise<void>;
}

// ClientRepository (optional, for DCR)
interface ClientRepository {
  register(redirectUris: string[]): Promise<RegisteredClient>;
  findById(clientId: string): Promise<RegisteredClient | null>;
  validateRedirectUri(clientId: string, redirectUri: string): Promise<boolean>;
}
```

### 8.2 Implementation Strategy

1. **Create interface files** in `src/server/oauth/repositories/types.ts`

2. **Wrap existing in-memory logic** in classes implementing these interfaces:
   - `InMemoryAuthorizationCodeRepository`
   - `InMemoryRefreshTokenRepository`
   - `InMemoryAccessTokenRepository`
   - `InMemoryClientRepository`

3. **Update storage.ts** to export repository instances instead of bare functions:
   ```typescript
   export const authCodeRepo: AuthorizationCodeRepository = new InMemoryAuthorizationCodeRepository();
   export const refreshTokenRepo: RefreshTokenRepository = new InMemoryRefreshTokenRepository();
   // etc.
   ```

4. **Update consumers** to use repository methods:
   - `authorize.ts` → `authCodeRepo.create(...)`
   - `token.ts` → `refreshTokenRepo.findByToken(...)`, `accessTokenRepo.findByToken(...)`

5. **Later: Add Postgres implementations**:
   - `PostgresRefreshTokenRepository`
   - `PostgresAccessTokenRepository`
   - Swap at construction time based on config/env

### 8.3 Minimum Methods Per Repository

| Repository | Methods |
|------------|---------|
| AuthorizationCodeRepository | `create`, `findByCode`, `markAsUsed`, `delete` |
| RefreshTokenRepository | `create`, `findByToken`, `delete` |
| AccessTokenRepository | `store`, `findByToken`, `delete` |
| ClientRepository | `register`, `findById`, `validateRedirectUri` |

### 8.4 Consumer Mapping

| Consumer | Currently Uses | Should Use |
|----------|----------------|------------|
| `authorize.ts` | `storeAuthorizationCode`, `validateClientAndRedirectUri`, `getRegisteredClient` | `authCodeRepo`, `clientRepo` |
| `token.ts` | `getAuthorizationCode`, `deleteAuthorizationCode`, `storeToken`, `getToken`, `storeRefreshToken`, `getRefreshToken`, `deleteRefreshToken` | `authCodeRepo`, `accessTokenRepo`, `refreshTokenRepo` |
| `dcr.ts` | `registerClient` | `clientRepo` |

### 8.5 Test Considerations

- Keep `InMemory*` implementations for unit tests
- E2E tests can use either in-memory or Postgres (configurable)
- Add integration tests specifically for Postgres implementations
- Consider adding restart simulation tests once Postgres is in place

---

## 9. Summary

### Current State
- All auth state is in-memory Maps in `storage.ts`
- Server restarts break ChatGPT connections (refresh fails, privy exchange fails)
- `/mcp` endpoint itself is resilient (JWT-only validation)

### Must Persist for Restart Resilience
1. **Refresh tokens** — `refreshTokens` Map (token → clientId, userId, privyToken, scopes, expiresAt)
2. **Access tokens** — `tokens` Map (jwt → clientId, userId, privyToken, scopes, expiresAt)

### Recommended Approach
1. Define repository interfaces for clean abstraction
2. Wrap existing Maps in interface-implementing classes
3. Update consumers to use repositories
4. Add Postgres implementations
5. Use environment/config to select implementation
