/**
 * Tier 0 - Graceful Reauth Flow
 * Tests that expired/invalid Privy tokens trigger proper reauth responses
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runFullOauthFlow,
  callMcpWithAccessToken,
  setRouteError,
  setRouteResponse,
  resetRoutes,
  getTestContext,
  rawTokenRequest,
} from '../helpers/index.js';

describe('Flow: Graceful Reauth for Expired Privy Tokens', () => {
  beforeEach(() => {
    // Reset route responses before each test
    resetRoutes();
  });

  describe('extract_intent tool', () => {
    it('returns reauth error when Protocol API says privy token is invalid', async () => {
      // Set up fake Protocol API to return 403 with expired token error
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'I want to learn about machine learning',
      });

      // Should return 200 with tool-level error
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);

      // Should have user-friendly message
      expect(result.body.result.content[0].text).toContain('connection has expired');
      expect(result.body.result.content[0].text).toContain('sign in again');

      // Should have mcp/www_authenticate meta for reauth
      expect(result.body.result._meta).toBeDefined();
      expect(result.body.result._meta['mcp/www_authenticate']).toBeDefined();
      expect(result.body.result._meta['mcp/www_authenticate']).toBeInstanceOf(Array);
      expect(result.body.result._meta['mcp/www_authenticate'].length).toBeGreaterThan(0);

      // WWW-Authenticate should reference our protected resource metadata
      const wwwAuth = result.body.result._meta['mcp/www_authenticate'][0];
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain('resource_metadata=');
      expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
      expect(wwwAuth).toContain('error="invalid_token"');
    });

    it('returns normal error for non-auth Protocol API errors', async () => {
      // Set up fake Protocol API to return 500 server error
      setRouteError('/discover/new', 500, { error: 'Internal server error' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'I want to learn about machine learning',
      });

      // Should return tool-level error but NOT trigger reauth
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Failed to extract intents');

      // Should NOT have mcp/www_authenticate meta
      expect(result.body.result._meta?.['mcp/www_authenticate']).toBeUndefined();
    });
  });

  describe('discover_connections tool', () => {
    it('returns reauth error when Protocol API says privy token is invalid on discover/new', async () => {
      // Set up fake Protocol API to return 403 with expired token error
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: 'I want to learn about machine learning',
      });

      // Should return 200 with tool-level error
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);

      // Should have user-friendly message
      expect(result.body.result.content[0].text).toContain('connection has expired');
      expect(result.body.result.content[0].text).toContain('sign in again');

      // Should have mcp/www_authenticate meta for reauth
      expect(result.body.result._meta).toBeDefined();
      expect(result.body.result._meta['mcp/www_authenticate']).toBeDefined();

      const wwwAuth = result.body.result._meta['mcp/www_authenticate'][0];
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain('resource_metadata=');
      expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
      expect(wwwAuth).toContain('error="invalid_token"');
    });

    it('returns reauth error when Protocol API says privy token is invalid on discover/filter', async () => {
      // Set up discover/new to succeed
      setRouteResponse('/discover/new', {
        intents: [
          {
            id: 'intent-1',
            payload: 'I want to learn about machine learning',
            summary: 'ML learning',
            createdAt: new Date().toISOString(),
          },
        ],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      // Set up discover/filter to return 403 with expired token error
      setRouteError('/discover/filter', 403, { error: 'Invalid or expired access token' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: 'I want to learn about machine learning',
      });

      // Should return 200 with tool-level error
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);

      // Should have user-friendly message
      expect(result.body.result.content[0].text).toContain('connection has expired');
      expect(result.body.result.content[0].text).toContain('sign in again');

      // Should have mcp/www_authenticate meta for reauth
      expect(result.body.result._meta).toBeDefined();
      expect(result.body.result._meta['mcp/www_authenticate']).toBeDefined();
    });

    it('returns normal error for non-auth Protocol API errors', async () => {
      // Set up fake Protocol API to return 500 server error
      setRouteError('/discover/new', 500, { error: 'Internal server error' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: 'I want to learn about machine learning',
      });

      // Should return tool-level error but NOT trigger reauth
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Failed to discover connections');

      // Should NOT have mcp/www_authenticate meta
      expect(result.body.result._meta?.['mcp/www_authenticate']).toBeUndefined();
    });
  });

  describe('/token/privy/access-token endpoint', () => {
    it('returns 401 with WWW-Authenticate when session is marked as privy-invalid', async () => {
      const { server } = getTestContext();

      // First, get a valid OAuth flow
      const { accessToken } = await runFullOauthFlow();

      // Set up Protocol API to return expired token error
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      // Call extract_intent to trigger the privy invalidation
      await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      // Now try to exchange for privy token again - should fail
      const response = await fetch(`${server.baseUrl}/token/privy/access-token`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      // Should return 401
      expect(response.status).toBe(401);

      // Should have WWW-Authenticate header
      const wwwAuth = response.headers.get('WWW-Authenticate');
      expect(wwwAuth).toBeDefined();
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain('resource_metadata=');
      expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
      expect(wwwAuth).toContain('error="invalid_token"');

      // Body should indicate privy token is invalid
      const body = await response.json();
      expect(body.error).toBe('privy_token_invalid');
    });

    it('second tool call triggers reauth when exchange endpoint returns privy_token_invalid', async () => {
      // First, get a valid OAuth flow
      const { accessToken } = await runFullOauthFlow();

      // Set up Protocol API to return expired token error on first call
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      // First tool call - this marks the session as invalid and returns reauth
      const firstResult = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'first call',
      });

      // First call should return reauth error
      expect(firstResult.status).toBe(200);
      expect(firstResult.body.result.isError).toBe(true);
      expect(firstResult.body.result._meta?.['mcp/www_authenticate']).toBeDefined();

      // Reset routes - now Protocol API would succeed, but exchange will fail
      // because the session is already marked invalid
      resetRoutes();

      // Second tool call - the session is marked invalid so it should trigger reauth
      // without even calling the Protocol API
      const secondResult = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'second call',
      });

      // Should return 200 with tool-level reauth error (not a generic error)
      expect(secondResult.status).toBe(200);
      expect(secondResult.body.result.isError).toBe(true);

      // CRITICAL: Should have mcp/www_authenticate meta for reauth
      // This is the bug we're fixing - without the fix, this would be undefined
      expect(secondResult.body.result._meta).toBeDefined();
      expect(secondResult.body.result._meta['mcp/www_authenticate']).toBeDefined();
      expect(secondResult.body.result._meta['mcp/www_authenticate']).toBeInstanceOf(Array);
      expect(secondResult.body.result._meta['mcp/www_authenticate'].length).toBeGreaterThan(0);

      // Should have user-friendly message
      expect(secondResult.body.result.content[0].text).toContain('connection has expired');
      expect(secondResult.body.result.content[0].text).toContain('sign in again');

      // WWW-Authenticate should reference our protected resource metadata
      const wwwAuth = secondResult.body.result._meta['mcp/www_authenticate'][0];
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain('resource_metadata=');
      expect(wwwAuth).toContain('/.well-known/oauth-protected-resource');
      expect(wwwAuth).toContain('error="invalid_token"');
    });
  });

  describe('error message variations', () => {
    it('handles "Invalid privy token" error message', async () => {
      setRouteError('/discover/new', 401, { error: 'Invalid privy token' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      expect(result.body.result.isError).toBe(true);
      expect(result.body.result._meta?.['mcp/www_authenticate']).toBeDefined();
    });

    it('handles "expired privy token" error message', async () => {
      setRouteError('/discover/new', 401, { message: 'expired privy token' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      expect(result.body.result.isError).toBe(true);
      expect(result.body.result._meta?.['mcp/www_authenticate']).toBeDefined();
    });

    it('does NOT trigger reauth for unrelated 403 errors', async () => {
      // 403 but with a different error message
      setRouteError('/discover/new', 403, { error: 'Forbidden: insufficient permissions' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      // Should be error but NOT trigger reauth
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result._meta?.['mcp/www_authenticate']).toBeUndefined();
    });
  });

  describe('refresh token revocation', () => {
    it('revokes refresh tokens when privy token expires, forcing full reauth', async () => {
      // Step 1: Complete OAuth flow and get tokens
      const { accessToken, refreshToken, authParams } = await runFullOauthFlow();

      // Step 2: Set up Protocol API to return expired token error
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      // Step 3: Call extract_intent to trigger privy expiration handling
      // This should:
      // - Mark the access token session as privy-invalid
      // - Revoke all refresh tokens for this client+user
      const toolResult = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      // Verify tool returned reauth error
      expect(toolResult.body.result.isError).toBe(true);
      expect(toolResult.body.result._meta?.['mcp/www_authenticate']).toBeDefined();

      // Step 4: Try to use the refresh token - should fail because it's revoked
      const refreshResult = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: authParams.clientId,
      });

      // Should return 400 with invalid_grant (revoked token)
      expect(refreshResult.status).toBe(400);
      expect(refreshResult.body.error).toBe('invalid_grant');
      expect(refreshResult.body.error_description).toContain('revoked');
    });

    it('forces visible reauth when ChatGPT tries to refresh after privy expiry', async () => {
      // This test simulates the ChatGPT flow:
      // 1. ChatGPT has valid access + refresh tokens
      // 2. Tool call fails with mcp/www_authenticate (privy expired)
      // 3. ChatGPT tries to refresh (as it would with a normal token expiry)
      // 4. Refresh MUST fail to force visible reauth UI

      const { accessToken, refreshToken, authParams } = await runFullOauthFlow();

      // Simulate privy expiration on Protocol API
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      // Tool call triggers the privy expiration flow
      await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      // ChatGPT sees mcp/www_authenticate and tries to refresh
      // This MUST fail - otherwise ChatGPT silently gets new tokens with the same bad privy
      const refreshResult = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: authParams.clientId,
      });

      // CRITICAL: Refresh must fail to break the silent refresh loop
      expect(refreshResult.status).toBe(400);
      expect(refreshResult.body.error).toBe('invalid_grant');

      // ChatGPT will now be forced to show visible reauth UI
      // because it can't silently refresh
    });

    it('revokes refresh tokens for discover_connections too', async () => {
      const { accessToken, refreshToken, authParams } = await runFullOauthFlow();

      // Privy expiration on Protocol API
      setRouteError('/discover/new', 403, { error: 'Invalid or expired access token' });

      // discover_connections should also revoke refresh tokens
      const toolResult = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: 'test',
      });

      expect(toolResult.body.result.isError).toBe(true);
      expect(toolResult.body.result._meta?.['mcp/www_authenticate']).toBeDefined();

      // Refresh should fail
      const refreshResult = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: authParams.clientId,
      });

      expect(refreshResult.status).toBe(400);
      expect(refreshResult.body.error).toBe('invalid_grant');
    });
  });
});
