/**
 * Unit tests for discoverConnectionsFromText orchestrator
 * Uses mocked protocol client functions
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { discoverConnectionsFromText } from '../../src/server/mcp/discoverConnections.js';

// Mock the protocol client module
vi.mock('../../src/server/protocol/client.js', () => ({
  exchangePrivyToken: vi.fn(),
  callDiscoverNew: vi.fn(),
  callDiscoverFilter: vi.fn(),
  callVibecheck: vi.fn(),
}));

// Import mocked functions
import {
  exchangePrivyToken,
  callDiscoverNew,
  callDiscoverFilter,
  callVibecheck,
} from '../../src/server/protocol/client.js';

// Cast to mocks for easier usage
const mockExchangePrivyToken = exchangePrivyToken as Mock;
const mockCallDiscoverNew = callDiscoverNew as Mock;
const mockCallDiscoverFilter = callDiscoverFilter as Mock;
const mockCallVibecheck = callVibecheck as Mock;

describe('discoverConnectionsFromText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for token exchange
    mockExchangePrivyToken.mockResolvedValue('privy-token-123');
  });

  describe('happy path', () => {
    it('returns connections with synthesis for multiple users', async () => {
      // Setup mocks
      mockCallDiscoverNew.mockResolvedValue({
        intents: [
          { id: 'intent-1', payload: 'ML interest', summary: 'ML', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'intent-2', payload: 'Systems interest', summary: 'Systems', createdAt: '2024-01-01T00:00:00Z' },
        ],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 2,
      });

      mockCallDiscoverFilter.mockResolvedValue({
        results: [
          {
            user: { id: 'user-1', name: 'Alice', email: null, avatar: 'avatar1.jpg', intro: null },
            totalStake: 100,
            intents: [
              { intent: { id: 'intent-1', payload: 'ML', createdAt: '2024-01-01T00:00:00Z' }, totalStake: 100, reasonings: [] },
            ],
          },
          {
            user: { id: 'user-2', name: 'Bob', email: null, avatar: null, intro: null },
            totalStake: 80,
            intents: [
              { intent: { id: 'intent-2', payload: 'Systems', createdAt: '2024-01-01T00:00:00Z' }, totalStake: 80, reasonings: [] },
              { intent: { id: 'intent-1', payload: 'ML', createdAt: '2024-01-01T00:00:00Z' }, totalStake: 50, reasonings: [] },
            ],
          },
          {
            user: { id: 'user-3', name: 'Charlie', email: null, avatar: 'avatar3.jpg', intro: null },
            totalStake: 60,
            intents: [
              { intent: { id: 'intent-1', payload: 'ML', createdAt: '2024-01-01T00:00:00Z' }, totalStake: 60, reasonings: [] },
            ],
          },
        ],
        pagination: { page: 1, limit: 10, hasNext: false, hasPrev: false },
        filters: { intentIds: null, userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
      });

      mockCallVibecheck.mockImplementation(async (token: string, params: { targetUserId: string }) => {
        const syntheses: Record<string, string> = {
          'user-1': 'Alice synthesis',
          'user-2': 'Bob synthesis',
          'user-3': 'Charlie synthesis',
        };
        return {
          synthesis: syntheses[params.targetUserId] || '',
          targetUserId: params.targetUserId,
          contextUserId: 'context',
        };
      });

      // Execute
      const result = await discoverConnectionsFromText({
        oauthToken: 'oauth-token',
        fullInputText: 'Test input',
        maxConnections: 10,
      });

      // Verify callDiscoverFilter was called with correct intentIds
      expect(mockCallDiscoverFilter).toHaveBeenCalledTimes(1);
      expect(mockCallDiscoverFilter).toHaveBeenCalledWith(
        'privy-token-123',
        {
          intentIds: ['intent-1', 'intent-2'],
          excludeDiscovered: true,
          page: 1,
          limit: 10,
        },
      );

      // Verify
      expect(result.connections.length).toBe(3);
      expect(result.intents.length).toBe(2);

      // Check first connection
      expect(result.connections[0].user.id).toBe('user-1');
      expect(result.connections[0].user.name).toBe('Alice');
      expect(result.connections[0].user.avatar).toBe('avatar1.jpg');
      expect(result.connections[0].mutualIntentCount).toBe(1);
      expect(result.connections[0].synthesis).toBe('Alice synthesis');

      // Check second connection
      expect(result.connections[1].user.id).toBe('user-2');
      expect(result.connections[1].mutualIntentCount).toBe(2);
      expect(result.connections[1].synthesis).toBe('Bob synthesis');

      // Check third connection
      expect(result.connections[2].user.id).toBe('user-3');
      expect(result.connections[2].user.avatar).toBe('avatar3.jpg');
      expect(result.connections[2].synthesis).toBe('Charlie synthesis');

      // Verify vibecheck was called for each user
      expect(mockCallVibecheck).toHaveBeenCalledTimes(3);
      expect(mockCallVibecheck).toHaveBeenCalledWith(
        'privy-token-123',
        expect.objectContaining({
          targetUserId: 'user-1',
          intentIds: ['intent-1', 'intent-2'],
        }),
      );
    });

    it('passes exactly the intent ids returned from discover/new to discover/filter', async () => {
      mockExchangePrivyToken.mockResolvedValue('privy-token-xyz');
      mockCallDiscoverNew.mockResolvedValue({
        intents: [
          { id: 'foo', payload: 'interest-a', summary: null, createdAt: '2024-01-01T00:00:00.000Z' },
          { id: 'bar', payload: 'interest-b', summary: null, createdAt: '2024-01-01T00:00:00.000Z' },
        ],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 2,
      });

      mockCallDiscoverFilter.mockResolvedValue({
        results: [],
        pagination: { page: 1, limit: 10, hasNext: false, hasPrev: false },
        filters: { intentIds: ['foo', 'bar'], userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
      });

      mockCallVibecheck.mockResolvedValue({
        synthesis: '',
        targetUserId: '',
        contextUserId: '',
      });

      await discoverConnectionsFromText({
        oauthToken: 'oauth-token-xyz',
        fullInputText: 'whatever',
        maxConnections: 10,
      });

      expect(mockCallDiscoverFilter).toHaveBeenCalledWith(
        'privy-token-xyz',
        {
          intentIds: ['foo', 'bar'],
          excludeDiscovered: true,
          page: 1,
          limit: 10,
        },
      );
    });
  });

  describe('no intents', () => {
    it('returns empty connections when no intents extracted', async () => {
      mockCallDiscoverNew.mockResolvedValue({
        intents: [],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 0,
      });

      const result = await discoverConnectionsFromText({
        oauthToken: 'oauth-token',
        fullInputText: 'Empty input',
        maxConnections: 10,
      });

      expect(result.connections.length).toBe(0);
      expect(result.intents.length).toBe(0);

      // Verify filter and vibecheck were never called
      expect(mockCallDiscoverFilter).not.toHaveBeenCalled();
      expect(mockCallVibecheck).not.toHaveBeenCalled();
    });
  });

  describe('no connections', () => {
    it('returns empty connections when filter returns no results', async () => {
      mockCallDiscoverNew.mockResolvedValue({
        intents: [
          { id: 'intent-1', payload: 'Test', createdAt: '2024-01-01T00:00:00Z' },
        ],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      mockCallDiscoverFilter.mockResolvedValue({
        results: [],
        pagination: { page: 1, limit: 10, hasNext: false, hasPrev: false },
        filters: { intentIds: null, userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
      });

      const result = await discoverConnectionsFromText({
        oauthToken: 'oauth-token',
        fullInputText: 'Test input',
        maxConnections: 10,
      });

      expect(result.connections.length).toBe(0);
      expect(result.intents.length).toBe(1);

      // Verify vibecheck was never called
      expect(mockCallVibecheck).not.toHaveBeenCalled();
    });
  });

  describe('partial vibecheck failures', () => {
    it('returns empty synthesis for failed vibechecks but does not fail overall', async () => {
      mockCallDiscoverNew.mockResolvedValue({
        intents: [
          { id: 'intent-1', payload: 'Test', createdAt: '2024-01-01T00:00:00Z' },
        ],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      mockCallDiscoverFilter.mockResolvedValue({
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
        filters: { intentIds: null, userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
      });

      // First call succeeds, second fails
      mockCallVibecheck
        .mockResolvedValueOnce({
          synthesis: 'Alice synthesis',
          targetUserId: 'user-1',
          contextUserId: 'context',
        })
        .mockRejectedValueOnce(new Error('Vibecheck failed for user-2'));

      const result = await discoverConnectionsFromText({
        oauthToken: 'oauth-token',
        fullInputText: 'Test input',
        maxConnections: 10,
      });

      // Should not throw
      expect(result.connections.length).toBe(2);

      // First connection has synthesis
      expect(result.connections[0].synthesis).toBe('Alice synthesis');

      // Second connection has empty synthesis due to failure
      expect(result.connections[1].synthesis).toBe('');
    });
  });

  describe('error propagation', () => {
    it('throws when token exchange fails', async () => {
      mockExchangePrivyToken.mockRejectedValue(new Error('Token exchange failed'));

      await expect(
        discoverConnectionsFromText({
          oauthToken: 'oauth-token',
          fullInputText: 'Test',
          maxConnections: 10,
        })
      ).rejects.toThrow('Token exchange failed');
    });

    it('throws when discover/new fails', async () => {
      mockCallDiscoverNew.mockRejectedValue(new Error('discover/new failed: 500'));

      await expect(
        discoverConnectionsFromText({
          oauthToken: 'oauth-token',
          fullInputText: 'Test',
          maxConnections: 10,
        })
      ).rejects.toThrow('discover/new failed');
    });

    it('throws when discover/filter fails', async () => {
      mockCallDiscoverNew.mockResolvedValue({
        intents: [{ id: 'intent-1', payload: 'Test', createdAt: '2024-01-01T00:00:00Z' }],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      mockCallDiscoverFilter.mockRejectedValue(new Error('discover/filter failed: 500'));

      await expect(
        discoverConnectionsFromText({
          oauthToken: 'oauth-token',
          fullInputText: 'Test',
          maxConnections: 10,
        })
      ).rejects.toThrow('discover/filter failed');
    });
  });

  describe('concurrency', () => {
    it('calls vibecheck for all users', async () => {
      mockCallDiscoverNew.mockResolvedValue({
        intents: [{ id: 'intent-1', payload: 'Test', createdAt: '2024-01-01T00:00:00Z' }],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      const users = Array.from({ length: 5 }, (_, i) => ({
        user: { id: `user-${i}`, name: `User ${i}`, email: null, avatar: null, intro: null },
        totalStake: 100 - i * 10,
        intents: [],
      }));

      mockCallDiscoverFilter.mockResolvedValue({
        results: users,
        pagination: { page: 1, limit: 10, hasNext: false, hasPrev: false },
        filters: { intentIds: null, userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
      });

      mockCallVibecheck.mockImplementation(async (token: string, params: { targetUserId: string }) => ({
        synthesis: `Synthesis for ${params.targetUserId}`,
        targetUserId: params.targetUserId,
        contextUserId: 'context',
      }));

      const result = await discoverConnectionsFromText({
        oauthToken: 'oauth-token',
        fullInputText: 'Test input',
        maxConnections: 10,
      });

      // All 5 vibechecks should be called
      expect(mockCallVibecheck).toHaveBeenCalledTimes(5);
      expect(result.connections.length).toBe(5);

      // Each should have synthesis
      for (let i = 0; i < 5; i++) {
        expect(result.connections[i].synthesis).toBe(`Synthesis for user-${i}`);
      }
    });
  });

  describe('character limit', () => {
    it('passes character limit to vibecheck', async () => {
      mockCallDiscoverNew.mockResolvedValue({
        intents: [{ id: 'intent-1', payload: 'Test', createdAt: '2024-01-01T00:00:00Z' }],
        filesProcessed: 0,
        linksProcessed: 0,
        intentsGenerated: 1,
      });

      mockCallDiscoverFilter.mockResolvedValue({
        results: [
          {
            user: { id: 'user-1', name: 'Alice', email: null, avatar: null, intro: null },
            totalStake: 100,
            intents: [],
          },
        ],
        pagination: { page: 1, limit: 10, hasNext: false, hasPrev: false },
        filters: { intentIds: null, userIds: null, indexIds: null, sources: null, excludeDiscovered: true },
      });

      mockCallVibecheck.mockResolvedValue({
        synthesis: 'Short synthesis',
        targetUserId: 'user-1',
        contextUserId: 'context',
      });

      await discoverConnectionsFromText({
        oauthToken: 'oauth-token',
        fullInputText: 'Test input',
        maxConnections: 10,
        characterLimit: 200,
      });

      expect(mockCallVibecheck).toHaveBeenCalledWith(
        'privy-token-123',
        expect.objectContaining({
          characterLimit: 200,
        }),
      );
    });
  });
});
