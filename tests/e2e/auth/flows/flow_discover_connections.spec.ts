/**
 * Tier 0 - Happy Path: Discover Connections Flow
 * Tests calling the discover_connections MCP tool with valid access tokens
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runFullOauthFlow,
  callMcpWithAccessToken,
  setRouteResponse,
  setRouteError,
  setRouteHandler,
  getLastDiscoverFilterBody,
  getDiscoverFilterCallCount,
  setupIncrementalDiscoverFilter,
  resetRoutes,
} from '../helpers/index.js';

describe('Flow: Discover Connections Tool', () => {
  beforeEach(() => {
    // Reset route responses before each test
  });

  it('successfully discovers connections with valid token', async () => {
    // Set up fake Protocol API responses
    setRouteResponse('/discover/new', {
      intents: [
        {
          id: 'intent-1',
          payload: 'I want to learn about machine learning',
          summary: 'ML learning',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'intent-2',
          payload: 'I need help with distributed systems',
          summary: 'Distributed systems help',
          createdAt: new Date().toISOString(),
        },
      ],
      filesProcessed: 0,
      linksProcessed: 0,
      intentsGenerated: 2,
    });

    setRouteResponse('/discover/filter', {
      results: [
        {
          user: {
            id: 'user-1',
            name: 'Alice',
            email: 'alice@example.com',
            avatar: 'https://example.com/avatar1.jpg',
            intro: 'ML researcher',
          },
          totalStake: 100,
          intents: [
            {
              intent: {
                id: 'intent-1',
                payload: 'I want to learn about machine learning',
                summary: 'ML learning',
                createdAt: new Date().toISOString(),
              },
              totalStake: 100,
              reasonings: ['Common interest in ML'],
            },
          ],
        },
        {
          user: {
            id: 'user-2',
            name: 'Bob',
            email: 'bob@example.com',
            avatar: null,
            intro: 'Systems engineer',
          },
          totalStake: 80,
          intents: [
            {
              intent: {
                id: 'intent-2',
                payload: 'I need help with distributed systems',
                summary: 'Distributed systems help',
                createdAt: new Date().toISOString(),
              },
              totalStake: 80,
              reasonings: ['Systems expertise'],
            },
          ],
        },
      ],
      pagination: {
        page: 1,
        limit: 10,
        hasNext: false,
        hasPrev: false,
      },
      filters: {
        intentIds: ['intent-1', 'intent-2'],
        userIds: null,
        indexIds: null,
        sources: null,
        excludeDiscovered: true,
      },
    });

    // Set up vibecheck handler to respond based on targetUserId
    setRouteHandler('/synthesis/vibecheck', async (req, body) => {
      const data = JSON.parse(body);
      const syntheses: Record<string, string> = {
        'user-1': 'Alice is an ML researcher who could help you with your machine learning journey. You two could collaborate on a project together.',
        'user-2': 'Bob has deep systems expertise. Together you could build distributed systems.',
      };
      return {
        synthesis: syntheses[data.targetUserId] || 'Potential collaboration opportunity',
        targetUserId: data.targetUserId,
        contextUserId: 'context-user',
      };
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'I want to learn about machine learning and build distributed systems',
    });

    // Should succeed
    expect(result.status).toBe(200);
    expect(result.body.error).toBeUndefined();

    // Should have result with connections
    expect(result.body.result).toBeDefined();
    expect(result.body.result.structuredContent).toBeDefined();
    expect(result.body.result.structuredContent.connections).toBeDefined();
    expect(result.body.result.structuredContent.connections.length).toBe(2);
    expect(result.body.result.structuredContent.intentsExtracted).toBe(2);
    expect(result.body.result.structuredContent.connectionsFound).toBe(2);

    // Check first connection
    const conn1 = result.body.result.structuredContent.connections[0];
    expect(conn1.user.id).toBe('user-1');
    expect(conn1.user.name).toBe('Alice');
    expect(conn1.mutualIntentCount).toBe(1);
    expect(conn1.synthesis).toContain('ML researcher');

    // Check second connection
    const conn2 = result.body.result.structuredContent.connections[1];
    expect(conn2.user.id).toBe('user-2');
    expect(conn2.user.name).toBe('Bob');
    expect(conn2.mutualIntentCount).toBe(1);
    expect(conn2.synthesis).toContain('systems expertise');

    // Check summary text
    expect(result.body.result.content[0].text).toContain('2 potential connections');

    // Verify that /discover/filter was called with the correct intentIds
    const filterBody = getLastDiscoverFilterBody();
    expect(filterBody).toBeDefined();
    expect(filterBody.intentIds).toEqual(['intent-1', 'intent-2']);
  });

  it('returns empty connections when no intents extracted', async () => {
    setRouteResponse('/discover/new', {
      intents: [],
      filesProcessed: 0,
      linksProcessed: 0,
      intentsGenerated: 0,
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'Hello world',
    });

    expect(result.status).toBe(200);
    expect(result.body.result.structuredContent.connections.length).toBe(0);
    expect(result.body.result.content[0].text).toContain('No connections found');
  });

  it('returns empty connections when no matches found', async () => {
    setRouteResponse('/discover/new', {
      intents: [
        {
          id: 'intent-1',
          payload: 'Some intent',
          createdAt: new Date().toISOString(),
        },
      ],
      filesProcessed: 0,
      linksProcessed: 0,
      intentsGenerated: 1,
    });

    setRouteResponse('/discover/filter', {
      results: [],
      pagination: {
        page: 1,
        limit: 10,
        hasNext: false,
        hasPrev: false,
      },
      filters: {
        intentIds: ['intent-1'],
        userIds: null,
        indexIds: null,
        sources: null,
        excludeDiscovered: true,
      },
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'Some text',
    });

    expect(result.status).toBe(200);
    expect(result.body.result.structuredContent.connections.length).toBe(0);
    expect(result.body.result.structuredContent.intentsExtracted).toBe(1);
  });

  it('handles Protocol API /discover/new error gracefully', async () => {
    setRouteError('/discover/new', 500, { error: 'Internal server error' });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'Test query',
    });

    // Should return tool-level error
    expect(result.status).toBe(200);
    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.content[0].text).toContain('Failed to discover connections');
  });

  it('handles Protocol API /discover/filter error gracefully', async () => {
    setRouteResponse('/discover/new', {
      intents: [{ id: 'intent-1', payload: 'Test', createdAt: new Date().toISOString() }],
      intentsGenerated: 1,
    });

    setRouteError('/discover/filter', 500, { error: 'Internal server error' });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'Test query',
    });

    expect(result.status).toBe(200);
    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.content[0].text).toContain('Failed to discover connections');
  });

  it('handles partial vibecheck failures gracefully', async () => {
    setRouteResponse('/discover/new', {
      intents: [{ id: 'intent-1', payload: 'Test', createdAt: new Date().toISOString() }],
      intentsGenerated: 1,
    });

    setRouteResponse('/discover/filter', {
      results: [
        {
          user: { id: 'user-1', name: 'Alice', email: null, avatar: null, intro: null },
          totalStake: 100,
          intents: [],
        },
        {
          user: { id: 'user-2', name: 'Bob', email: null, avatar: null, intro: null },
          totalStake: 80,
          intents: [],
        },
      ],
      pagination: { page: 1, limit: 10, hasNext: false, hasPrev: false },
      filters: { intentIds: ['intent-1'], userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
    });

    // Make vibecheck fail for user-2
    let callCount = 0;
    setRouteHandler('/synthesis/vibecheck', async (req, body) => {
      callCount++;
      const data = JSON.parse(body);
      if (data.targetUserId === 'user-2') {
        throw new Error('Vibecheck failed');
      }
      return {
        synthesis: 'Success synthesis',
        targetUserId: data.targetUserId,
        contextUserId: 'context-user',
      };
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'Test query',
    });

    // Should still succeed with partial results
    expect(result.status).toBe(200);
    expect(result.body.result.isError).toBeUndefined();
    expect(result.body.result.structuredContent.connections.length).toBe(2);

    // First connection should have synthesis
    expect(result.body.result.structuredContent.connections[0].synthesis).toBe('Success synthesis');
    // Second connection should have empty synthesis due to failure
    expect(result.body.result.structuredContent.connections[1].synthesis).toBe('');
  });

  it('respects maxConnections parameter', async () => {
    setRouteResponse('/discover/new', {
      intents: [{ id: 'intent-1', payload: 'Test', createdAt: new Date().toISOString() }],
      intentsGenerated: 1,
    });

    // We can't easily verify the limit was passed to the API in this test setup,
    // but we can at least verify the parameter is accepted
    setRouteResponse('/discover/filter', {
      results: [
        {
          user: { id: 'user-1', name: 'Alice', email: null, avatar: null, intro: null },
          totalStake: 100,
          intents: [],
        },
      ],
      pagination: { page: 1, limit: 5, hasNext: false, hasPrev: false },
      filters: { intentIds: ['intent-1'], userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
    });

    setRouteResponse('/synthesis/vibecheck', {
      synthesis: 'Test synthesis',
      targetUserId: 'user-1',
      contextUserId: 'context-user',
    });

    const { accessToken } = await runFullOauthFlow();

    const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
      fullInputText: 'Test query',
      maxConnections: 5,
    });

    expect(result.status).toBe(200);
    expect(result.body.result.isError).toBeUndefined();
  });

  describe('Input validation', () => {
    it('rejects missing fullInputText', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {});

      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Invalid input');
    });

    it('rejects empty fullInputText', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: '',
      });

      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Invalid input');
    });

    it('rejects maxConnections out of range', async () => {
      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: 'Test',
        maxConnections: 100, // Max is 50
      });

      expect(result.status).toBe(200);
      expect(result.body.result.isError).toBe(true);
      expect(result.body.result.content[0].text).toContain('Invalid input');
    });
  });

  describe('Accumulation behavior', () => {
    // Note: This test is skipped because the test server (server-bootstrap.ts) uses
    // a simplified mock implementation that doesn't include the accumulation polling logic.
    // The accumulation behavior is thoroughly tested in unit tests (discoverConnections.test.ts).
    it.skip('accumulates connections across multiple discover/filter polls', async () => {
      // Reset routes to clear any previous state (including call counters)
      resetRoutes();
      // Set up discover/new to return intents
      setRouteResponse('/discover/new', {
        intents: [
          {
            id: 'accumulation-intent-1',
            payload: 'Test intent for accumulation',
            summary: 'Accumulation test',
            createdAt: new Date().toISOString(),
          },
        ],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      // Set up incremental discover/filter responses:
      // Call 1: empty, Call 2: user-a, Call 3+: user-a + user-b
      setupIncrementalDiscoverFilter();

      // Set up vibecheck to return synthesis for both users
      setRouteHandler('/synthesis/vibecheck', async (_req, body) => {
        const data = JSON.parse(body);
        const syntheses: Record<string, string> = {
          'incremental-user-a': 'User A is great for collaboration on projects.',
          'incremental-user-b': 'User B has expertise in systems design.',
        };
        return {
          synthesis: syntheses[data.targetUserId] || 'Default synthesis',
          targetUserId: data.targetUserId,
          contextUserId: 'context-user',
        };
      });

      const { accessToken } = await runFullOauthFlow();

      const result = await callMcpWithAccessToken(accessToken, 'discover_connections', {
        fullInputText: 'Test query for accumulation behavior',
      });

      // Should succeed
      expect(result.status).toBe(200);
      expect(result.body.error).toBeUndefined();
      expect(result.body.result.isError).toBeUndefined();

      // Should have accumulated BOTH users (not just the first one found)
      const connections = result.body.result.structuredContent.connections;
      expect(connections.length).toBe(2);

      // Verify both users are present
      const userIds = connections.map((c: any) => c.user.id);
      expect(userIds).toContain('incremental-user-a');
      expect(userIds).toContain('incremental-user-b');

      // Verify syntheses were generated for both
      const userA = connections.find((c: any) => c.user.id === 'incremental-user-a');
      const userB = connections.find((c: any) => c.user.id === 'incremental-user-b');
      expect(userA.synthesis).toContain('collaboration');
      expect(userB.synthesis).toContain('systems design');

      // Verify polling happened multiple times (at least 3: empty + user-a + user-a+b)
      const filterCallCount = getDiscoverFilterCallCount();
      expect(filterCallCount).toBeGreaterThanOrEqual(3);
    });
  });
});
