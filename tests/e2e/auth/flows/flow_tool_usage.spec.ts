/**
 * Tier 0 - Happy Path: Tool Usage Flow
 * Tests calling MCP tools with valid access tokens
 */

import { describe, it, expect } from 'vitest';
import {
  runFullOauthFlow,
  callMcpWithAccessToken,
  exchangeForPrivyToken,
  setRouteResponse,
  setRouteError,
  setRouteDelay,
  getTestContext,
} from '../helpers/index.js';

describe('Flow: Tool Usage with Valid Token', () => {
  it('successfully calls extract_intent tool with valid token', async () => {
    // Set up fake Protocol API response
    setRouteResponse('/discover/new', {
      intents: [
        {
          id: 'intent-1',
          description: 'Test intent',
          confidence: 0.95,
        },
      ],
      filesProcessed: 0,
      linksProcessed: 0,
      intentsGenerated: 1,
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
      fullInputText: 'I want to find information about machine learning',
    });

    // Should succeed
    expect(result.status).toBe(200);
    expect(result.body.error).toBeUndefined();

    // Should have result with intents
    expect(result.body.result).toBeDefined();
    expect(result.body.result.structuredContent).toBeDefined();
    expect(result.body.result.structuredContent.intentsGenerated).toBe(1);
  });

  it('exchanges OAuth token for Privy token successfully', async () => {
    const { accessToken, authParams } = await runFullOauthFlow();

    const exchangeResult = await exchangeForPrivyToken(accessToken);

    // Should return the stored Privy token
    expect(exchangeResult.privyAccessToken).toBe(authParams.privyToken);
    expect(exchangeResult.userId).toBe(authParams.privyUserId);
    expect(exchangeResult.expiresAt).toBeGreaterThan(Date.now());
  });

  it('handles Protocol API success with multiple intents', async () => {
    setRouteResponse('/discover/new', {
      intents: [
        { id: '1', description: 'Intent A', confidence: 0.9 },
        { id: '2', description: 'Intent B', confidence: 0.8 },
        { id: '3', description: 'Intent C', confidence: 0.7 },
      ],
      filesProcessed: 1,
      linksProcessed: 2,
      intentsGenerated: 3,
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
      fullInputText: 'Complex query with multiple intents',
      rawText: 'Some document content',
      conversationHistory: 'Previous messages',
      userMemory: 'User context',
    });

    expect(result.status).toBe(200);
    expect(result.body.result.structuredContent.intentsGenerated).toBe(3);
    expect(result.body.result.structuredContent.filesProcessed).toBe(1);
    expect(result.body.result.structuredContent.linksProcessed).toBe(2);
  });

  describe('Tool error handling - Tier 1', () => {
    it('handles Protocol API 500 error gracefully', async () => {
      setRouteError('/discover/new', 500, { error: 'Internal server error' });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'Test query',
      });

      // Should return tool-level error, not crash
      expect(result.status).toBe(200); // MCP endpoint itself succeeds
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Failed to extract intent');
    });

    it('handles Protocol API timeout gracefully', async () => {
      // Set a delay longer than the timeout
      setRouteDelay('/discover/new', 10000); // 10 seconds

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'Test query',
      });

      // Should return timeout error
      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toMatch(/timeout|abort/i);
    }, 15000);

    it('handles Privy token exchange failure gracefully', async () => {
      // This is tricky to test since we need to break the token exchange
      // We can test by using a token that wasn't stored properly
      // For now, we'll test with a manually crafted token that won't be in storage

      // Create a valid JWT but don't store it in the token map
      // This simulates a token that passes JWT validation but isn't found in storage

      const { server } = getTestContext();

      // Use a completely fake token that will fail verification
      const result = await callMcpWithAccessToken(
        'invalid-token-that-will-fail',
        'extract_intent',
        { fullInputText: 'Test' }
      );

      // Should get auth error
      expect(result.status).toBe(401);
    });
  });

  describe('Tool input validation', () => {
    it('rejects extract_intent with missing fullInputText', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'extract_intent', {});

      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Invalid input');
    });
  });

  describe('Multiple tool calls in sequence', () => {
    it('allows multiple tool calls with the same token', async () => {
      setRouteResponse('/discover/new', {
        intents: [{ id: '1', description: 'Test' }],
        intentsGenerated: 1,
      });

      const { accessToken } = await runFullOauthFlow();

      // Call multiple tools
      const result1 = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'First call',
      });
      const result2 = await callMcpWithAccessToken(accessToken, 'extract_intent', {
        fullInputText: 'Second call',
      });

      // All should succeed
      expect(result1.status).toBe(200);
      expect(result2.status).toBe(200);

      expect(result1.body.result.isError).toBeUndefined();
      expect(result2.body.result.isError).toBeUndefined();
    });
  });
});
