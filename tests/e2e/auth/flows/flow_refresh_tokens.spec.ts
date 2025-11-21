/**
 * Tier 0 - Happy Path: Token Refresh Flow
 * Tests refresh token rotation and continued access
 */

import { describe, it, expect } from 'vitest';
import {
  runFullOauthFlow,
  refreshTokens,
  callMcpWithAccessToken,
  decodeAccessToken,
  rawTokenRequest,
  getTestContext,
  setRouteResponse,
} from '../helpers/index.js';

describe('Flow: Refresh Tokens', () => {
  it('refreshes tokens and issues new access token', async () => {
    const initial = await runFullOauthFlow();

    // Refresh tokens
    const refreshed = await refreshTokens(initial.refreshToken);

    // Should have new tokens
    expect(refreshed.newAccessToken).toBeDefined();
    expect(refreshed.newRefreshToken).toBeDefined();
    expect(refreshed.expiresIn).toBeGreaterThan(0);

    // Refresh token should always be different (random generation)
    expect(refreshed.newRefreshToken).not.toBe(initial.refreshToken);

    // Scope should be preserved
    expect(refreshed.scope).toContain('read');
    expect(refreshed.scope).toContain('privy:token:exchange');
  });

  it('preserves user identity (sub claim) after refresh', async () => {
    const initial = await runFullOauthFlow();
    const initialDecoded = decodeAccessToken(initial.accessToken);

    const refreshed = await refreshTokens(initial.refreshToken);
    const refreshedDecoded = decodeAccessToken(refreshed.newAccessToken);

    // Subject should be the same
    expect(refreshedDecoded.sub).toBe(initialDecoded.sub);

    // Client ID should be the same
    expect(refreshedDecoded.client_id).toBe(initialDecoded.client_id);

    // Scope should be the same
    expect(refreshedDecoded.scope).toBe(initialDecoded.scope);
  });

  it('preserves issuer and audience after refresh', async () => {
    const { server } = getTestContext();
    const initial = await runFullOauthFlow();
    const refreshed = await refreshTokens(initial.refreshToken);

    const decoded = decodeAccessToken(refreshed.newAccessToken);

    expect(decoded.iss).toBe(server.baseUrl);
    expect(decoded.aud).toBe(server.baseUrl);
  });

  it('invalidates old refresh token after use (rotation)', async () => {
    const initial = await runFullOauthFlow();

    // Use the refresh token
    await refreshTokens(initial.refreshToken);

    // Try to use the old refresh token again
    const reuse = await rawTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: initial.refreshToken,
      client_id: 'chatgpt-connector',
    });

    // Should fail
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe('invalid_grant');
  });

  it('allows tool calls with refreshed access token', async () => {
    setRouteResponse('/discover/new', {
      intents: [{ id: '1', description: 'Test after refresh' }],
      intentsGenerated: 1,
    });

    const initial = await runFullOauthFlow();
    const refreshed = await refreshTokens(initial.refreshToken);

    // Call tool with new access token
    const result = await callMcpWithAccessToken(refreshed.newAccessToken, 'extract_intent', {
      fullInputText: 'Test after refresh',
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBeUndefined();
    expect(result.body.result.structuredContent.intentsGenerated).toBe(1);
  });

  it('supports multiple sequential refresh cycles', async () => {
    setRouteResponse('/discover/new', {
      intents: [{ id: '1', description: 'After multiple refreshes' }],
      intentsGenerated: 1,
    });

    let current = await runFullOauthFlow();

    // Refresh multiple times
    for (let i = 0; i < 3; i++) {
      const refreshed = await refreshTokens(current.refreshToken);

      // Each refresh should work
      expect(refreshed.newAccessToken).toBeDefined();
      expect(refreshed.newRefreshToken).toBeDefined();

      // Refresh token should always be different (random generation)
      expect(refreshed.newRefreshToken).not.toBe(current.refreshToken);

      // Update current for next iteration
      current = {
        ...current,
        accessToken: refreshed.newAccessToken,
        refreshToken: refreshed.newRefreshToken,
      };
    }

    // Final token should still work
    const result = await callMcpWithAccessToken(current.accessToken, 'extract_intent', {
      fullInputText: 'After multiple refreshes',
    });

    expect(result.status).toBe(200);
    expect(result.body.error).toBeUndefined();
  });

  it('preserves Privy token through refresh cycle', async () => {
    // This is important for the extract_intent tool which needs the Privy token
    const initial = await runFullOauthFlow();
    const refreshed = await refreshTokens(initial.refreshToken);

    // The Privy token should still be accessible after refresh
    // We verify this by calling extract_intent which requires the Privy token
    setRouteResponse('/discover/new', {
      intents: [{ id: '1', description: 'Test' }],
      intentsGenerated: 1,
    });

    const result = await callMcpWithAccessToken(
      refreshed.newAccessToken,
      'extract_intent',
      { fullInputText: 'Test query' }
    );

    expect(result.status).toBe(200);
    expect(result.body.result.isError).toBeUndefined();
    expect(result.body.result.structuredContent.intentsGenerated).toBe(1);
  });

  describe('Refresh token error cases', () => {
    it('rejects refresh with wrong client_id', async () => {
      const initial = await runFullOauthFlow();

      const result = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: initial.refreshToken,
        client_id: 'wrong-client-id',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
      expect(result.body.error_description).toContain('mismatch');
    });

    it('rejects refresh with missing refresh_token', async () => {
      const result = await rawTokenRequest({
        grant_type: 'refresh_token',
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
      expect(result.body.error_description).toContain('refresh_token');
    });

    it('rejects refresh with invalid refresh_token', async () => {
      const result = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: 'invalid-token-xyz',
        client_id: 'chatgpt-connector',
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_grant');
    });

    it('rejects refresh with missing client_id', async () => {
      const initial = await runFullOauthFlow();

      const result = await rawTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: initial.refreshToken,
      });

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request');
    });
  });

  describe('Token expiration', () => {
    it('issues tokens with valid expiration times', async () => {
      const initial = await runFullOauthFlow();
      const decoded = decodeAccessToken(initial.accessToken);

      const now = Math.floor(Date.now() / 1000);

      // exp should be in the future
      expect(decoded.exp).toBeGreaterThan(now);

      // exp should be approximately 1 hour from now (with some margin)
      const oneHourFromNow = now + 3600;
      expect(decoded.exp).toBeLessThanOrEqual(oneHourFromNow + 60); // Allow 60s margin
      expect(decoded.exp).toBeGreaterThanOrEqual(oneHourFromNow - 60);

      // iat should be approximately now
      expect(decoded.iat).toBeLessThanOrEqual(now + 5);
      expect(decoded.iat).toBeGreaterThanOrEqual(now - 60);
    });

    it('issues refreshed tokens with fresh expiration', async () => {
      const initial = await runFullOauthFlow();
      const initialDecoded = decodeAccessToken(initial.accessToken);

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 100));

      const refreshed = await refreshTokens(initial.refreshToken);
      const refreshedDecoded = decodeAccessToken(refreshed.newAccessToken);

      // New token should have later expiration
      expect(refreshedDecoded.exp).toBeGreaterThanOrEqual(initialDecoded.exp);
      expect(refreshedDecoded.iat).toBeGreaterThanOrEqual(initialDecoded.iat);
    });
  });
});
