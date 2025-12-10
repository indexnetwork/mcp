/**
 * Unit tests for OAuth repositories
 *
 * Tests verify:
 * 1. Basic CRUD operations work correctly
 * 2. Behavior is consistent across multiple repo instances (simulating restart)
 * 3. Expiration and revocation logic works correctly
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryClientRepository,
  InMemoryAuthorizationCodeRepository,
  InMemoryRefreshTokenRepository,
  InMemoryAccessTokenSessionRepository,
  createInMemoryRepositories,
} from '../../src/server/oauth/repositories/inMemory.js';

describe('InMemoryClientRepository', () => {
  let repo: InMemoryClientRepository;

  beforeEach(() => {
    repo = new InMemoryClientRepository();
  });

  it('creates and retrieves a client by id', async () => {
    const client = await repo.create({
      id: 'client_test123',
      clientName: 'Test Client',
      redirectUris: ['https://example.com/callback'],
    });

    expect(client.id).toBe('client_test123');
    expect(client.clientName).toBe('Test Client');
    expect(client.redirectUris).toEqual(['https://example.com/callback']);
    expect(client.createdAt).toBeInstanceOf(Date);

    const found = await repo.findById('client_test123');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('client_test123');
    expect(found!.clientName).toBe('Test Client');
  });

  it('returns null for non-existent client', async () => {
    const found = await repo.findById('non-existent-client');
    expect(found).toBeNull();
  });

  it('creates client with multiple redirect URIs', async () => {
    await repo.create({
      id: 'client_multi_uris',
      redirectUris: [
        'https://example.com/callback1',
        'https://example.com/callback2',
        'https://chatgpt.com/connector_platform_oauth_redirect',
      ],
    });

    const found = await repo.findById('client_multi_uris');
    expect(found!.redirectUris).toHaveLength(3);
    expect(found!.redirectUris).toContain('https://example.com/callback1');
    expect(found!.redirectUris).toContain('https://chatgpt.com/connector_platform_oauth_redirect');
  });

  it('finds client by id and redirect URI', async () => {
    await repo.create({
      id: 'client_with_uri',
      redirectUris: ['https://allowed.com/callback', 'https://also-allowed.com/callback'],
    });

    // Should find with matching redirect URI
    const found = await repo.findByIdAndRedirectUri('client_with_uri', 'https://allowed.com/callback');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('client_with_uri');

    // Should also find with the other allowed URI
    const found2 = await repo.findByIdAndRedirectUri('client_with_uri', 'https://also-allowed.com/callback');
    expect(found2).not.toBeNull();
  });

  it('returns null for non-matching redirect URI', async () => {
    await repo.create({
      id: 'client_strict_uri',
      redirectUris: ['https://allowed.com/callback'],
    });

    // Should not find with non-matching redirect URI
    const found = await repo.findByIdAndRedirectUri('client_strict_uri', 'https://evil.com/callback');
    expect(found).toBeNull();
  });

  it('returns null for non-existent client with findByIdAndRedirectUri', async () => {
    const found = await repo.findByIdAndRedirectUri('non-existent', 'https://any.com/callback');
    expect(found).toBeNull();
  });

  it('creates client without clientName', async () => {
    const client = await repo.create({
      id: 'client_no_name',
      redirectUris: ['https://example.com/callback'],
    });

    expect(client.clientName).toBeUndefined();

    const found = await repo.findById('client_no_name');
    expect(found!.clientName).toBeUndefined();
  });

  it('overwrites existing client on re-create (upsert behavior)', async () => {
    // First create
    await repo.create({
      id: 'client_upsert',
      clientName: 'Original Name',
      redirectUris: ['https://original.com/callback'],
    });

    // Re-create with same ID but different data
    await repo.create({
      id: 'client_upsert',
      clientName: 'Updated Name',
      redirectUris: ['https://updated.com/callback'],
    });

    const found = await repo.findById('client_upsert');
    expect(found!.clientName).toBe('Updated Name');
    expect(found!.redirectUris).toEqual(['https://updated.com/callback']);
  });
});

describe('InMemoryAuthorizationCodeRepository', () => {
  let repo: InMemoryAuthorizationCodeRepository;

  beforeEach(() => {
    repo = new InMemoryAuthorizationCodeRepository();
  });

  it('creates and retrieves an authorization code', async () => {
    const code = await repo.create({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      privyUserId: 'did:privy:user123',
      privyToken: 'privy-token-xyz',
      scopes: ['read', 'write'],
      codeChallenge: 'challenge123',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 30000),
    });

    expect(code).toBeDefined();
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);

    const record = await repo.findByCode(code);
    expect(record).not.toBeNull();
    expect(record!.clientId).toBe('test-client');
    expect(record!.privyUserId).toBe('did:privy:user123');
    expect(record!.scopes).toEqual(['read', 'write']);
    expect(record!.used).toBe(false);
  });

  it('returns null for non-existent code', async () => {
    const record = await repo.findByCode('non-existent-code');
    expect(record).toBeNull();
  });

  it('marks code as used', async () => {
    const code = await repo.create({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      privyUserId: 'did:privy:user123',
      privyToken: 'privy-token-xyz',
      scopes: ['read'],
      codeChallenge: 'challenge123',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 30000),
    });

    await repo.markAsUsed(code);

    const record = await repo.findByCode(code);
    expect(record!.used).toBe(true);
  });

  it('deletes code', async () => {
    const code = await repo.create({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      privyUserId: 'did:privy:user123',
      privyToken: 'privy-token-xyz',
      scopes: ['read'],
      codeChallenge: 'challenge123',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 30000),
    });

    await repo.delete(code);

    const record = await repo.findByCode(code);
    expect(record).toBeNull();
  });

  it('cleans up expired codes', async () => {
    const expiredCode = await repo.create({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      privyUserId: 'did:privy:user123',
      privyToken: 'privy-token-xyz',
      scopes: ['read'],
      codeChallenge: 'challenge123',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    const validCode = await repo.create({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      privyUserId: 'did:privy:user456',
      privyToken: 'privy-token-abc',
      scopes: ['read'],
      codeChallenge: 'challenge456',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 30000), // Still valid
    });

    await repo.cleanupExpired();

    expect(await repo.findByCode(expiredCode)).toBeNull();
    expect(await repo.findByCode(validCode)).not.toBeNull();
  });

  it('cleans up used codes', async () => {
    const usedCode = await repo.create({
      clientId: 'test-client',
      redirectUri: 'https://example.com/callback',
      privyUserId: 'did:privy:user123',
      privyToken: 'privy-token-xyz',
      scopes: ['read'],
      codeChallenge: 'challenge123',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 30000),
    });

    await repo.markAsUsed(usedCode);
    await repo.cleanupExpired();

    expect(await repo.findByCode(usedCode)).toBeNull();
  });
});

describe('InMemoryRefreshTokenRepository', () => {
  let repo: InMemoryRefreshTokenRepository;

  beforeEach(() => {
    repo = new InMemoryRefreshTokenRepository();
  });

  it('creates and retrieves a refresh token', async () => {
    const record = await repo.create({
      token: 'refresh-token-abc123',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read', 'write'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    expect(record.id).toBeDefined();
    expect(record.token).toBe('refresh-token-abc123');
    expect(record.revokedAt).toBeNull();

    const found = await repo.findByToken('refresh-token-abc123');
    expect(found).not.toBeNull();
    expect(found!.clientId).toBe('test-client');
    expect(found!.privyUserId).toBe('did:privy:user123');
    expect(found!.privyAccessToken).toBe('privy-access-token-xyz');
  });

  it('returns null for non-existent token', async () => {
    const found = await repo.findByToken('non-existent-token');
    expect(found).toBeNull();
  });

  it('revokes token by token string', async () => {
    await repo.create({
      token: 'refresh-token-to-revoke',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await repo.revokeByToken('refresh-token-to-revoke');

    const found = await repo.findByToken('refresh-token-to-revoke');
    expect(found).not.toBeNull();
    expect(found!.revokedAt).not.toBeNull();
  });

  it('revokes token by id', async () => {
    const record = await repo.create({
      token: 'refresh-token-by-id',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await repo.revokeById(record.id);

    const found = await repo.findByToken('refresh-token-by-id');
    expect(found!.revokedAt).not.toBeNull();
  });

  it('cleans up expired tokens', async () => {
    await repo.create({
      token: 'expired-refresh-token',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    await repo.create({
      token: 'valid-refresh-token',
      clientId: 'test-client',
      privyUserId: 'did:privy:user456',
      privyAccessToken: 'privy-access-token-abc',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await repo.cleanupExpired();

    expect(await repo.findByToken('expired-refresh-token')).toBeNull();
    expect(await repo.findByToken('valid-refresh-token')).not.toBeNull();
  });

  it('cleans up revoked tokens', async () => {
    await repo.create({
      token: 'revoked-refresh-token',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await repo.revokeByToken('revoked-refresh-token');
    await repo.cleanupExpired();

    expect(await repo.findByToken('revoked-refresh-token')).toBeNull();
  });
});

describe('InMemoryAccessTokenSessionRepository', () => {
  let repo: InMemoryAccessTokenSessionRepository;

  beforeEach(() => {
    repo = new InMemoryAccessTokenSessionRepository();
  });

  it('creates and retrieves a session by jti', async () => {
    const record = await repo.create({
      jti: 'jwt-id-abc123',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read', 'write'],
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
    });

    expect(record.id).toBeDefined();
    expect(record.jti).toBe('jwt-id-abc123');

    const found = await repo.findByJti('jwt-id-abc123');
    expect(found).not.toBeNull();
    expect(found!.clientId).toBe('test-client');
    expect(found!.privyUserId).toBe('did:privy:user123');
    expect(found!.privyAccessToken).toBe('privy-access-token-xyz');
  });

  it('returns null for non-existent jti', async () => {
    const found = await repo.findByJti('non-existent-jti');
    expect(found).toBeNull();
  });

  it('deletes session by jti', async () => {
    await repo.create({
      jti: 'jwt-id-to-delete',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 3600000),
    });

    await repo.deleteByJti('jwt-id-to-delete');

    const found = await repo.findByJti('jwt-id-to-delete');
    expect(found).toBeNull();
  });

  it('cleans up expired sessions', async () => {
    await repo.create({
      jti: 'expired-session',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    await repo.create({
      jti: 'valid-session',
      clientId: 'test-client',
      privyUserId: 'did:privy:user456',
      privyAccessToken: 'privy-access-token-abc',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 3600000),
    });

    await repo.cleanupExpired();

    expect(await repo.findByJti('expired-session')).toBeNull();
    expect(await repo.findByJti('valid-session')).not.toBeNull();
  });

  it('marks session as privy-invalid', async () => {
    await repo.create({
      jti: 'session-to-invalidate',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-access-token-xyz',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 3600000),
    });

    // Initially should not have privyInvalidAt
    let found = await repo.findByJti('session-to-invalidate');
    expect(found).not.toBeNull();
    expect(found!.privyInvalidAt).toBeUndefined();

    // Mark as invalid
    const invalidAt = new Date();
    await repo.markPrivyInvalid('session-to-invalidate', invalidAt);

    // Should now have privyInvalidAt set
    found = await repo.findByJti('session-to-invalidate');
    expect(found).not.toBeNull();
    expect(found!.privyInvalidAt).toEqual(invalidAt);
  });

  it('markPrivyInvalid does nothing for non-existent session', async () => {
    // Should not throw
    await repo.markPrivyInvalid('non-existent-jti', new Date());
  });
});

describe('Repository persistence simulation', () => {
  it('in-memory repos do NOT persist across instances (baseline behavior)', async () => {
    // This test documents the expected behavior of in-memory repos:
    // data is lost when a new instance is created (simulating restart)

    const repo1 = new InMemoryRefreshTokenRepository();
    await repo1.create({
      token: 'token-from-instance-1',
      clientId: 'test-client',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-token',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // Simulate restart: create new repo instance
    const repo2 = new InMemoryRefreshTokenRepository();

    // Token should NOT be found in the new instance
    const found = await repo2.findByToken('token-from-instance-1');
    expect(found).toBeNull();
  });

  it('factory creates independent repository instances', () => {
    const repos1 = createInMemoryRepositories();
    const repos2 = createInMemoryRepositories();

    // Each call should return new instances
    expect(repos1.clients).not.toBe(repos2.clients);
    expect(repos1.authorizationCodes).not.toBe(repos2.authorizationCodes);
    expect(repos1.refreshTokens).not.toBe(repos2.refreshTokens);
    expect(repos1.accessTokenSessions).not.toBe(repos2.accessTokenSessions);
  });

  it('in-memory client repos do NOT persist across instances (baseline behavior)', async () => {
    const repo1 = new InMemoryClientRepository();
    await repo1.create({
      id: 'client_from_instance_1',
      redirectUris: ['https://example.com/callback'],
    });

    // Simulate restart: create new repo instance
    const repo2 = new InMemoryClientRepository();

    // Client should NOT be found in the new instance
    const found = await repo2.findById('client_from_instance_1');
    expect(found).toBeNull();
  });

  it('full auth flow works within single repo instance set', async () => {
    const repos = createInMemoryRepositories();

    // 0. Register client first
    await repos.clients.create({
      id: 'chatgpt-connector',
      clientName: 'ChatGPT Connector',
      redirectUris: ['https://chatgpt.com/callback'],
    });

    // Verify client exists
    const client = await repos.clients.findById('chatgpt-connector');
    expect(client).not.toBeNull();

    // 1. Create authorization code
    const authCode = await repos.authorizationCodes.create({
      clientId: 'chatgpt-connector',
      redirectUri: 'https://chatgpt.com/callback',
      privyUserId: 'did:privy:user123',
      privyToken: 'privy-token-from-auth',
      scopes: ['mcp:tools'],
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 30000),
    });

    // 2. Retrieve and verify auth code
    const authCodeRecord = await repos.authorizationCodes.findByCode(authCode);
    expect(authCodeRecord).not.toBeNull();
    expect(authCodeRecord!.privyToken).toBe('privy-token-from-auth');

    // 3. Mark auth code as used
    await repos.authorizationCodes.markAsUsed(authCode);

    // 4. Create refresh token (simulating token exchange)
    const refreshToken = 'refresh-token-' + Date.now();
    const refreshRecord = await repos.refreshTokens.create({
      token: refreshToken,
      clientId: 'chatgpt-connector',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-token-from-auth',
      scopes: ['mcp:tools'],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // 5. Create access token session
    const jti = 'jti-' + Date.now();
    await repos.accessTokenSessions.create({
      jti,
      clientId: 'chatgpt-connector',
      privyUserId: 'did:privy:user123',
      privyAccessToken: 'privy-token-from-auth',
      scopes: ['mcp:tools'],
      expiresAt: new Date(Date.now() + 3600000),
    });

    // 6. Verify refresh token can be retrieved
    const foundRefresh = await repos.refreshTokens.findByToken(refreshToken);
    expect(foundRefresh).not.toBeNull();
    expect(foundRefresh!.privyAccessToken).toBe('privy-token-from-auth');

    // 7. Verify access token session can be retrieved by jti
    const foundSession = await repos.accessTokenSessions.findByJti(jti);
    expect(foundSession).not.toBeNull();
    expect(foundSession!.privyAccessToken).toBe('privy-token-from-auth');

    // 8. Simulate refresh flow: use refresh token to get privy token
    const refreshForExchange = await repos.refreshTokens.findByToken(refreshToken);
    expect(refreshForExchange!.privyAccessToken).toBe('privy-token-from-auth');

    // 9. Delete auth code after successful exchange
    await repos.authorizationCodes.delete(authCode);
    expect(await repos.authorizationCodes.findByCode(authCode)).toBeNull();
  });
});
