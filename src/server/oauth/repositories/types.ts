/**
 * Repository interfaces for OAuth auth storage
 *
 * Persistence scope:
 * - OAuth clients: must persist for restart survival (DCR-generated clients)
 * - Refresh tokens: must persist for session survival across restarts
 * - Access token sessions: must persist for /mcp/token/privy/access-token to work
 * - Authorization codes: short-lived (30s), can stay in-memory
 */

// ============================================================================
// OAuth Clients (must persist for DCR-generated clients to survive restarts)
// ============================================================================

export interface OAuthClientRecord {
  id: string;              // client_id, e.g. "client_..." or "chatgpt-connector"
  clientName?: string;     // optional display name
  redirectUris: string[];  // allowed redirect URIs
  createdAt: Date;
}

export interface ClientRepository {
  create(client: Omit<OAuthClientRecord, 'createdAt'>): Promise<OAuthClientRecord>;
  findById(id: string): Promise<OAuthClientRecord | null>;
  findByIdAndRedirectUri(id: string, redirectUri: string): Promise<OAuthClientRecord | null>;
}

// ============================================================================
// Authorization Codes (can stay in-memory - 30s lifetime)
// ============================================================================

export interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  privyUserId: string;
  privyToken: string;
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  expiresAt: Date;
  used: boolean;
  createdAt: Date;
}

export interface AuthorizationCodeRepository {
  create(data: Omit<AuthorizationCodeRecord, 'code' | 'used' | 'createdAt'>): Promise<string>;
  findByCode(code: string): Promise<AuthorizationCodeRecord | null>;
  markAsUsed(code: string): Promise<void>;
  delete(code: string): Promise<void>;
  cleanupExpired(now?: Date): Promise<void>;
}

// ============================================================================
// Refresh Tokens (must persist for restart survival)
// ============================================================================

export interface RefreshTokenRecord {
  id: string;
  token: string;
  clientId: string;
  privyUserId: string;
  privyAccessToken: string;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface RefreshTokenRepository {
  create(record: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>): Promise<RefreshTokenRecord>;
  findByToken(rawToken: string): Promise<RefreshTokenRecord | null>;
  revokeByToken(token: string): Promise<void>;
  revokeById(id: string): Promise<void>;
  revokeAllForUser(clientId: string, privyUserId: string, when: Date): Promise<void>;
  cleanupExpired(now?: Date): Promise<void>;
}

// ============================================================================
// Access Token Sessions (must persist for /mcp/token/privy/access-token)
// ============================================================================

export interface AccessTokenSessionRecord {
  id: string;
  jti: string; // JWT ID claim - unique identifier for the access token
  clientId: string;
  privyUserId: string;
  privyAccessToken: string;
  scopes: string[];
  expiresAt: Date;
  createdAt: Date;
  privyInvalidAt?: Date | null; // Set when privy token is known to be invalid/expired
}

export interface AccessTokenSessionRepository {
  create(record: Omit<AccessTokenSessionRecord, 'id' | 'createdAt'>): Promise<AccessTokenSessionRecord>;
  findByJti(jti: string): Promise<AccessTokenSessionRecord | null>;
  deleteByJti(jti: string): Promise<void>;
  cleanupExpired(now?: Date): Promise<void>;
  markPrivyInvalid(jti: string, when: Date): Promise<void>;
}

// ============================================================================
// Aggregate interface for dependency injection
// ============================================================================

export interface AuthRepositories {
  clients: ClientRepository;
  authorizationCodes: AuthorizationCodeRepository;
  refreshTokens: RefreshTokenRepository;
  accessTokenSessions: AccessTokenSessionRepository;
}
