/**
 * In-memory storage for OAuth codes, tokens, and client registrations
 * Supports both static (pre-configured) and dynamic client registration
 * In production, replace with a database (Redis, PostgreSQL, etc.)
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// Static client configuration
// These clients are pre-registered and always available (survives server restarts)
const STATIC_CLIENT_ID = 'chatgpt-connector';
const STATIC_REDIRECT_URIS = [
  'https://chat.openai.com/connector_platform_oauth_redirect',
  'https://chatgpt.com/connector_platform_oauth_redirect',
];

// Types
export interface PrivyClaims {
  userId: string;
  appId: string;
  [key: string]: any;
}

export interface AuthorizationCode {
  code: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;  // Store the actual Privy token for later exchange
  privyClaims?: PrivyClaims;  // Verified claims from Privy
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  expiresAt: number;
  used: boolean;
}

export interface RegisteredClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  registeredAt: number;
}

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;  // Store the actual Privy token for token exchange
  scopes: string[];
  expiresAt: number;
}

export interface RefreshTokenData {
  token: string;
  clientId: string;
  privyUserId: string;
  privyToken: string;  // Store for refresh token flow
  scopes: string[];
  expiresAt: number;
}

// In-memory stores
const authorizationCodes = new Map<string, AuthorizationCode>();
const registeredClients = new Map<string, RegisteredClient>();
const tokens = new Map<string, TokenData>();
const refreshTokens = new Map<string, RefreshTokenData>();

// Bootstrap static clients on module load
function bootstrapStaticClients() {
  // Register the static ChatGPT client
  const staticClient: RegisteredClient = {
    clientId: STATIC_CLIENT_ID,
    redirectUris: [...STATIC_REDIRECT_URIS],
    registeredAt: Date.now(),
  };

  registeredClients.set(STATIC_CLIENT_ID, staticClient);
  console.log(`✓ Registered static OAuth client: ${STATIC_CLIENT_ID}`);
}

// Initialize static clients immediately
bootstrapStaticClients();

// Auto-cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();

  // Clean up expired authorization codes
  for (const [code, data] of authorizationCodes.entries()) {
    if (data.expiresAt < now || data.used) {
      authorizationCodes.delete(code);
    }
  }

  // Clean up expired tokens
  for (const [token, data] of tokens.entries()) {
    if (data.expiresAt < now) {
      tokens.delete(token);
    }
  }

  for (const [token, data] of refreshTokens.entries()) {
    if (data.expiresAt < now) {
      refreshTokens.delete(token);
    }
  }
}, 5 * 60 * 1000);

// Authorization Code Management
export function storeAuthorizationCode(data: Omit<AuthorizationCode, 'code' | 'used'>): string {
  const code = generateSecureCode();
  authorizationCodes.set(code, {
    ...data,
    code,
    used: false,
  });
  return code;
}

export function getAuthorizationCode(code: string): AuthorizationCode | undefined {
  return authorizationCodes.get(code);
}

export function markCodeAsUsed(code: string): void {
  const codeData = authorizationCodes.get(code);
  if (codeData) {
    codeData.used = true;
  }
}

export function deleteAuthorizationCode(code: string): void {
  authorizationCodes.delete(code);
}

// Client Registration Management
export function registerClient(redirectUris: string[]): RegisteredClient {
  const clientId = `client_${uuidv4()}`;
  const client: RegisteredClient = {
    clientId,
    redirectUris,
    registeredAt: Date.now(),
  };
  registeredClients.set(clientId, client);
  return client;
}

export function getRegisteredClient(clientId: string): RegisteredClient | undefined {
  return registeredClients.get(clientId);
}

export function validateClientAndRedirectUri(clientId: string, redirectUri: string): boolean {
  const client = registeredClients.get(clientId);
  if (!client) {
    return false;
  }
  return client.redirectUris.includes(redirectUri);
}

// Token Management
export function storeToken(accessToken: string, data: Omit<TokenData, 'accessToken'>): void {
  tokens.set(accessToken, {
    ...data,
    accessToken,
  });
}

export function getToken(accessToken: string): TokenData | undefined {
  return tokens.get(accessToken);
}

export function deleteToken(accessToken: string): void {
  tokens.delete(accessToken);
}

// Refresh Token Management
export function storeRefreshToken(data: Omit<RefreshTokenData, 'token'>): string {
  const token = generateSecureToken();
  refreshTokens.set(token, { ...data, token });
  return token;
}

export function getRefreshToken(token: string): RefreshTokenData | undefined {
  return refreshTokens.get(token);
}

export function deleteRefreshToken(token: string): void {
  refreshTokens.delete(token);
}

// Utility functions
function generateSecureCode(): string {
  // Generate cryptographically secure random string
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateSecureToken(): string {
  // Generate cryptographically secure random token
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// PKCE utilities
export function validatePKCE(codeVerifier: string, codeChallenge: string): boolean {
  // For S256 method: base64url(sha256(code_verifier)) === code_challenge
  const hash = createSHA256Hash(codeVerifier);
  const computedChallenge = base64UrlEncode(hash);
  return computedChallenge === codeChallenge;
}

function createSHA256Hash(input: string): Uint8Array {
  // Use Node.js crypto for proper SHA-256 hashing (works in both Node and Bun)
  const hash = createHash('sha256');
  hash.update(input);
  return new Uint8Array(hash.digest());
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
