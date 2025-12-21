/**
 * MCP Tool Definitions
 * Defines the tools available to ChatGPT with OAuth security
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { config } from '../config.js';
import { discoverConnectionsFromText } from './discoverConnections.js';
import { PrivyTokenExpiredError } from '../protocol/client.js';
import { WIDGETS } from './widgetConfig.js';
import { getRepositories } from '../oauth/repositories/index.js';

/**
 * Build a reauth error response for tool calls when Privy token is expired
 */
function buildPrivyExpiredResponse() {
  const resourceMetadata = `${config.server.baseUrl}/.well-known/oauth-protected-resource`;
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Your Index Network connection has expired. Please sign in again to continue.',
      },
    ],
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resourceMetadata}", error="invalid_token", error_description="Your connection expired. Click to sign in again."`,
      ],
    },
  };
}

/**
 * Zod schemas for tool input validation
 */
const DiscoverConnectionsSchema = z.object({
  fullInputText: z.string().min(1, 'Input text is required'),
  maxConnections: z.number().int().min(1).max(50).optional(),
});

/**
 * Register all MCP tools
 */
export function registerTools(server: Server) {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'discover_connections',
          description: 'Given some text, find potential connections to other Index users and synthesize how they might collaborate.',
          inputSchema: {
            type: 'object',
            properties: {
              fullInputText: {
                type: 'string',
                description: 'The text to analyze for finding connections',
              },
              maxConnections: {
                type: 'number',
                description: 'Maximum number of connections to return (1-50, default 10)',
              },
            },
            required: ['fullInputText'],
          },
          annotations: {
            readOnlyHint: true,
          },
          _meta: {
            'openai/outputTemplate': WIDGETS['discover-connections'].toolMeta.outputTemplate,
            'openai/toolInvocation/invoking': WIDGETS['discover-connections'].toolMeta.invoking,
            'openai/toolInvocation/invoked': WIDGETS['discover-connections'].toolMeta.invoked,
            'openai/widgetAccessible': WIDGETS['discover-connections'].toolMeta.widgetAccessible,
            'openai/resultCanProduceWidget': WIDGETS['discover-connections'].toolMeta.resultCanProduceWidget,
          },
        },
      ],
    };
  });

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    // Extract auth context from request metadata
    // Note: In Express integration, we'll pass this through
    const auth = (extra as any)?.auth;

    switch (name) {
      case 'discover_connections':
        return await handleDiscoverConnections(args, auth);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

/**
 * Handle discover_connections tool call
 */
async function handleDiscoverConnections(args: any, auth: any) {
  // 1. Validate authentication
  if (!auth || !auth.userId) {
    return {
      content: [{ type: 'text', text: 'Authentication required.' }],
      isError: true,
      _meta: { 'mcp/www_authenticate': 'Bearer resource_metadata="..."' },
    };
  }

  // 2. Validate input
  const parseResult = DiscoverConnectionsSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [{
        type: 'text',
        text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
      }],
      isError: true,
    };
  }

  const { fullInputText, maxConnections } = parseResult.data;

  // NOTE: dev-only short circuit for UI testing.
  // When DISCOVER_CONNECTIONS_MOCK=1 is set, this tool returns static connections
  // and skips all protocol API calls. Do not enable in production.
  // if (process.env.DISCOVER_CONNECTIONS_MOCK === '1') {
  //   const connections = [
  //     {
  //       user: {
  //         id: 'user-1',
  //         name: 'Alice Example',
  //         avatar: null,
  //       },
  //       mutualIntentCount: 3,
  //       synthesis:
  //         'This is a fake vibecheck for Alice. You might collaborate on [climate research](https://index.network/intents/intent-1) and [DAO governance](https://index.network/intents/intent-2).',
  //     },
  //     {
  //       user: {
  //         id: 'user-2',
  //         name: 'Bob Sample',
  //         avatar: null,
  //       },
  //       mutualIntentCount: 1,
  //       synthesis:
  //         'This is a fake vibecheck for Bob focused on [developer tooling](https://index.network/intents/intent-3).',
  //     },
  //   ];

  //   return {
  //     content: [
  //       {
  //         type: 'text',
  //         text: `Found ${connections.length} potential connections (mock).`,
  //       },
  //     ],
  //     structuredContent: {
  //       connections,
  //       intentsExtracted: 3,
  //       connectionsFound: connections.length,
  //     },
  //   };
  // }

  try {
    // 3. Call orchestrator
    const { connections, intents } = await discoverConnectionsFromText({
      oauthToken: auth.token,
      fullInputText,
      maxConnections: maxConnections ?? 10,
    });

    // 4. Generate invoked message for status display
    const invokedText =
      connections.length === 0
        ? 'No connections found'
        : connections.length === 1
          ? 'Found 1 potential connection'
          : `Found ${connections.length} potential connections`;

    // 5. Return structured response for widget
    return {
      content: [{
        type: 'text',
        text: 'Showing discovered connections in the widget below.',
      }],
      structuredContent: {
        connections,
        intentsExtracted: intents.length,
        connectionsFound: connections.length,
      },
      _meta: {
        'openai/toolInvocation/invoked': invokedText,
      },
    };
  } catch (error) {
    // Check for expired privy token - trigger reauth
    if (error instanceof PrivyTokenExpiredError) {
      console.error('[discover_connections] PrivyTokenExpiredError caught:', error.message);
      console.log('[discover_connections] Triggering reauth flow for user:', auth?.userId);

      const now = new Date();
      const jti = auth?.decoded?.jti;
      const clientId = auth?.decoded?.client_id;
      const privyUserId = auth?.decoded?.sub;

      // 1) Mark access-token session privy-invalid
      if (jti) {
        console.log('[discover_connections] Marking session invalid, jti:', jti);
        try {
          const repos = getRepositories();
          await repos.accessTokenSessions.markPrivyInvalid(jti, now);
          console.log('[discover_connections] Session marked invalid successfully');
        } catch (markError) {
          console.error('[discover_connections] Failed to mark session invalid:', markError);
        }
      }

      // 2) Revoke all refresh tokens for this client + user
      if (clientId && privyUserId) {
        console.log('[discover_connections] Revoking refresh tokens for client:', clientId, 'user:', privyUserId);
        try {
          const repos = getRepositories();
          await repos.refreshTokens.revokeAllForUser(clientId, privyUserId, now);
          console.log('[discover_connections] Refresh tokens revoked successfully');
        } catch (revokeError) {
          console.error('[discover_connections] Failed to revoke refresh tokens:', revokeError);
        }
      }

      // 3) Return reauth response
      const reauthResponse = buildPrivyExpiredResponse();
      console.log('[discover_connections] Returning reauth response:', JSON.stringify(reauthResponse));
      return reauthResponse;
    }

    console.error('Error discovering connections:', error);
    return {
      content: [{
        type: 'text',
        text: `Failed to discover connections: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      isError: true,
    };
  }
}
