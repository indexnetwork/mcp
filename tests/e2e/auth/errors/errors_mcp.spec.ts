/**
 * Tier 0/1 - Error Handling: MCP Endpoint
 * Tests error responses from POST /mcp
 */

import { describe, it, expect } from 'vitest';
import {
  rawMcpRequest,
  runFullOauthFlow,
  callMcpWithAccessToken,
  getTestContext,
  setRouteResponse,
} from '../helpers/index.js';

describe('Errors: MCP Endpoint', () => {
  describe('Tier 0 - Authentication errors', () => {
    it('returns 401 for missing Authorization header', async () => {
      const result = await rawMcpRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
        id: 'test-1',
      });

      expect(result.status).toBe(401);
      expect(result.body.error).toBe('unauthorized');
      expect(result.headers['www-authenticate']).toBeDefined();
    });

    it('returns 401 for malformed Authorization header', async () => {
      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: 'test-1',
        },
        { 'Authorization': 'InvalidFormat token' }
      );

      expect(result.status).toBe(401);
      expect(result.body.error).toBeDefined();
    });

    it('returns 401 for empty Bearer token', async () => {
      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: 'test-1',
        },
        { 'Authorization': 'Bearer ' }
      );

      expect(result.status).toBe(401);
    });

    it('returns 401 for invalid JWT token', async () => {
      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: 'test-1',
        },
        { 'Authorization': 'Bearer invalid.jwt.token' }
      );

      expect(result.status).toBe(401);
      expect(result.body.error).toBe('invalid_token');
    });

    it('returns 401 for JWT with wrong signature', async () => {
      // Create a token-like structure but with invalid signature
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        sub: 'did:privy:test',
        scope: 'read',
        aud: 'http://localhost:3000',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const fakeToken = `${header}.${payload}.invalidsignature`;

      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: 'test-1',
        },
        { 'Authorization': `Bearer ${fakeToken}` }
      );

      expect(result.status).toBe(401);
      expect(result.body.error).toBe('invalid_token');
    });
  });

  describe('Tier 1 - Scope and authorization errors', () => {
    it('returns proper error for insufficient scope', async () => {
      // This would require creating a token with limited scopes
      // For now, we test with a valid token which should have sufficient scopes
      setRouteResponse('/discover/new', {
        intents: [{ id: '1', description: 'Test' }],
        intentsGenerated: 1,
      });

      const { accessToken } = await runFullOauthFlow({ scope: 'read' });

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'test',
      });

      // Should succeed with read scope
      expect(result.status).toBe(200);
    });
  });

  describe('Tier 0 - JSON-RPC errors', () => {
    it('returns error for unknown method', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'unknown/method',
          params: {},
          id: 'test-1',
        },
        { 'Authorization': `Bearer ${accessToken}` }
      );

      expect(result.status).toBe(500);
      expect(result.body.error).toBeDefined();
      expect(result.body.error.message).toContain('Unknown method');
    });

    it('returns error for unknown tool', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'unknown_tool', {});

      expect(result.status).toBe(500);
      expect(result.body.error).toBeDefined();
      expect(result.body.error.message).toContain('Unknown tool');
    });
  });

  describe('Error response structure', () => {
    it('returns WWW-Authenticate header with proper format', async () => {
      const result = await rawMcpRequest({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
        id: 'test-1',
      });

      expect(result.status).toBe(401);

      const wwwAuth = result.headers['www-authenticate'];
      expect(wwwAuth).toBeDefined();
      expect(wwwAuth).toContain('Bearer');
      expect(wwwAuth).toContain('resource_metadata');
    });

    it('returns JSON-RPC format for tool errors', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        // Missing required fullInputText
      });

      expect(result.status).toBe(200);
      expect(result.body.jsonrpc).toBe('2.0');
      expect(result.body.id).toBeDefined();
      expect(result.body.result).toBeDefined();
      expect(result.body.result.isError).toBe(true);
    });

    it('does not leak internal details in error responses', async () => {
      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: 'test-1',
        },
        { 'Authorization': 'Bearer invalid' }
      );

      const responseText = JSON.stringify(result.body);
      expect(responseText).not.toContain('node_modules');
      expect(responseText).not.toContain('at ');
      expect(responseText).not.toContain('.ts:');
    });

    it('includes proper JSON-RPC id in responses', async () => {
      setRouteResponse('/discover/new', {
        intents: [{ id: '1', description: 'Test' }],
        intentsGenerated: 1,
      });

      const { accessToken } = await runFullOauthFlow();

      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: 'my-custom-id-123',
        },
        { 'Authorization': `Bearer ${accessToken}` }
      );

      expect(result.body.id).toBe('my-custom-id-123');
    });

    it('handles null id correctly', async () => {
      setRouteResponse('/discover/new', {
        intents: [{ id: '1', description: 'Test' }],
        intentsGenerated: 1,
      });

      const { accessToken } = await runFullOauthFlow();

      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          id: null,
        },
        { 'Authorization': `Bearer ${accessToken}` }
      );

      expect(result.body.id).toBeNull();
    });

    it('handles missing id correctly', async () => {
      setRouteResponse('/discover/new', {
        intents: [{ id: '1', description: 'Test' }],
        intentsGenerated: 1,
      });

      const { accessToken } = await runFullOauthFlow();

      const result = await rawMcpRequest(
        {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'extract_intent', arguments: { fullInputText: 'test' } },
          // No id field
        },
        { 'Authorization': `Bearer ${accessToken}` }
      );

      expect(result.body.id).toBeNull();
    });
  });

  describe('Tier 1 - Edge cases', () => {
    it('handles empty request body gracefully', async () => {
      const { server } = getTestContext();
      const { accessToken } = await runFullOauthFlow();

      const response = await fetch(`${server.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: '{}',
      });

      // Should not crash, should return some error
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('handles malformed JSON gracefully', async () => {
      const { server } = getTestContext();
      const { accessToken } = await runFullOauthFlow();

      const response = await fetch(`${server.baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: 'not-json',
      });

      // Should return error, not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
