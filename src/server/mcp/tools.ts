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
import { getItems, performAction } from '../api/backend.js';
import { config } from '../config.js';
import { discoverConnectionsFromText } from './discoverConnections.js';
import { exchangePrivyToken, callDiscoverNew } from '../protocol/client.js';
import { WIDGETS } from './widgetConfig.js';

/**
 * Zod schemas for tool input validation
 */
const GetItemsSchema = z.object({
  filter: z.string().optional(),
});

const PerformActionSchema = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  action: z.string().min(1, 'Action is required'),
});

const EchoSchema = z.object({
  text: z.string().min(1, 'Text is required'),
});

const ExtractIntentSchema = z.object({
  fullInputText: z.string().min(1, 'Input text is required'),
  rawText: z.string().optional(),
  conversationHistory: z.string().optional(),
  userMemory: z.string().optional(),
});

const DiscoverConnectionsSchema = z.object({
  fullInputText: z.string().min(1, 'Input text is required'),
  maxConnections: z.number().int().min(1).max(50).optional(),
});

/**
 * Register all MCP tools
 */
export function registerTools(server: Server) {
  // Tool 1: Get Items (read-only)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'get-items',
          description: 'Use this when the user wants to view items from their account. Returns a list of items that can be displayed in an interactive widget.',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                description: 'Optional filter to apply to the items list',
              },
            },
          },
          annotations: {
            readOnlyHint: true,
          },
          _meta: {
            'openai/outputTemplate': WIDGETS['list-view'].toolMeta.outputTemplate,
            'openai/toolInvocation/invoking': WIDGETS['list-view'].toolMeta.invoking,
            'openai/toolInvocation/invoked': WIDGETS['list-view'].toolMeta.invoked,
            'openai/widgetAccessible': WIDGETS['list-view'].toolMeta.widgetAccessible,
            'openai/resultCanProduceWidget': WIDGETS['list-view'].toolMeta.resultCanProduceWidget,
          },
        },
        {
          name: 'perform-item-action',
          description: 'Use this when the user wants to perform an action on a specific item. Requires the item ID.',
          inputSchema: {
            type: 'object',
            properties: {
              itemId: {
                type: 'string',
                description: 'The ID of the item to perform the action on',
              },
              action: {
                type: 'string',
                description: 'The action to perform (e.g., approve, reject, archive)',
              },
            },
            required: ['itemId', 'action'],
          },
          annotations: {
            readOnlyHint: true,
          },
        },
        {
          name: 'echo',
          description: 'Use this when the user wants to echo back some text. Simply displays the provided text in a nice widget.',
          inputSchema: {
            type: 'object',
            properties: {
              text: {
                type: 'string',
                description: 'The text to echo back to the user',
              },
            },
            required: ['text'],
          },
          annotations: {
            readOnlyHint: true,
          },
          _meta: {
            'openai/outputTemplate': WIDGETS.echo.toolMeta.outputTemplate,
            'openai/toolInvocation/invoking': WIDGETS.echo.toolMeta.invoking,
            'openai/toolInvocation/invoked': WIDGETS.echo.toolMeta.invoked,
            'openai/widgetAccessible': WIDGETS.echo.toolMeta.widgetAccessible,
            'openai/resultCanProduceWidget': WIDGETS.echo.toolMeta.resultCanProduceWidget,
          },
        },
        {
          name: 'extract_intent',
          description: 'Extracts and structures the user\'s goals, needs, or objectives from any conversation to help understand what they\'re trying to accomplish.',
          inputSchema: {
            type: 'object',
            properties: {
              fullInputText: {
                type: 'string',
                description: 'Full input text from the user',
              },
              rawText: {
                type: 'string',
                description: 'Raw text content from uploaded file (optional)',
              },
              conversationHistory: {
                type: 'string',
                description: 'Raw conversation history as text (optional)',
              },
              userMemory: {
                type: 'string',
                description: 'Raw user memory/context as text (optional)',
              },
            },
            required: ['fullInputText'],
          },
          annotations: {
            readOnlyHint: true,
          },
          _meta: {
            'openai/outputTemplate': WIDGETS['intent-display'].toolMeta.outputTemplate,
            'openai/toolInvocation/invoking': WIDGETS['intent-display'].toolMeta.invoking,
            'openai/toolInvocation/invoked': WIDGETS['intent-display'].toolMeta.invoked,
            'openai/widgetAccessible': WIDGETS['intent-display'].toolMeta.widgetAccessible,
            'openai/resultCanProduceWidget': WIDGETS['intent-display'].toolMeta.resultCanProduceWidget,
          },
        },
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
      case 'get-items':
        return await handleGetItems(args, auth);

      case 'perform-item-action':
        return await handlePerformAction(args, auth);

      case 'echo':
        return await handleEcho(args);

      case 'extract_intent':
        return await handleExtractIntent(args, auth);

      case 'discover_connections':
        return await handleDiscoverConnections(args, auth);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

/**
 * Handle get-items tool call
 */
async function handleGetItems(args: any, auth: any) {
  // Validate authentication
  if (!auth || !auth.userId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Authentication required to access items.',
        },
      ],
      isError: true,
      _meta: {
        'mcp/www_authenticate': 'Bearer resource_metadata="..."',
      },
    };
  }

  // Validate input with Zod
  const parseResult = GetItemsSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  const validatedArgs = parseResult.data;

  try {
    // Call backend API
    const items = await getItems(auth.userId, validatedArgs.filter);

    // Transform items for widget
    const widgetItems = items.map((item: any) => ({
      id: item.id,
      title: item.title || item.name,
      description: item.description || '',
      actionable: true,
      metadata: item.metadata || {},
    }));

    return {
      content: [
        {
          type: 'text',
          text: `Found ${items.length} items${validatedArgs.filter ? ` matching filter "${validatedArgs.filter}"` : ''}.`,
        },
      ],
      // Data for the widget
      structuredContent: {
        items: widgetItems,
      },
      // Invocation metadata only (widget metadata is in tool registration)
      _meta: {
        'openai/toolInvocation/invoking': 'Loading items...',
        'openai/toolInvocation/invoked': `Loaded ${items.length} items`,
      },
    };
  } catch (error) {
    console.error('Error fetching items:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Failed to fetch items: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle perform-item-action tool call
 */
async function handlePerformAction(args: any, auth: any) {
  // Validate authentication
  if (!auth || !auth.userId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Authentication required to perform actions.',
        },
      ],
      isError: true,
      _meta: {
        'mcp/www_authenticate': 'Bearer resource_metadata="..."',
      },
    };
  }

  // Validate input with Zod
  const parseResult = PerformActionSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  const validatedArgs = parseResult.data;

  try {
    // Call backend API
    const result = await performAction(auth.userId, validatedArgs.itemId, validatedArgs.action);

    return {
      content: [
        {
          type: 'text',
          text: `Successfully performed "${validatedArgs.action}" on item ${validatedArgs.itemId}.`,
        },
      ],
      structuredContent: {
        success: true,
        itemId: validatedArgs.itemId,
        action: validatedArgs.action,
        result,
      },
      _meta: {
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    console.error('Error performing action:', error);
    return {
      content: [
        {
          type: 'text',
          text: `Failed to perform action: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Handle echo tool call
 * Simple tool that echoes back the provided text
 */
async function handleEcho(args: any) {
  // Validate input with Zod
  const parseResult = EchoSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [
        {
          type: 'text',
          text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  const validatedArgs = parseResult.data;

  return {
    content: [
      {
        type: 'text',
        text: `Echo: ${validatedArgs.text}`,
      },
    ],
    // Data for the Echo widget
    structuredContent: {
      text: validatedArgs.text,
    },
    // Invocation metadata only (widget metadata is in tool registration)
    _meta: {
      'openai/toolInvocation/invoking': 'Echoing...',
      'openai/toolInvocation/invoked': 'Echo complete',
    },
  };
}

/**
 * Handle extract_intent tool call
 */
async function handleExtractIntent(args: any, auth: any) {
  // 1. Validate authentication
  if (!auth || !auth.userId) {
    return {
      content: [{ type: 'text', text: 'Authentication required.' }],
      isError: true,
      _meta: { 'mcp/www_authenticate': 'Bearer resource_metadata="..."' },
    };
  }

  // 2. Validate input
  const parseResult = ExtractIntentSchema.safeParse(args);
  if (!parseResult.success) {
    return {
      content: [{
        type: 'text',
        text: `Invalid input: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
      }],
      isError: true,
    };
  }

  const { fullInputText, rawText, conversationHistory, userMemory } = parseResult.data;

  try {
    // 3. Exchange OAuth token for Privy token
    const privyToken = await exchangePrivyToken(auth.token);

    // 4. Prepare payload - truncate sections to limits
    const truncate = (text: string | undefined, limit: number) =>
      text ? text.slice(0, limit) : '';

    const payload = [
      truncate(fullInputText, config.intentExtraction.instructionCharLimit),
      rawText ? `=== File Content ===\n${truncate(rawText, config.intentExtraction.sectionCharLimit)}` : '',
      conversationHistory ? `=== Conversation ===\n${truncate(conversationHistory, config.intentExtraction.sectionCharLimit)}` : '',
      userMemory ? `=== Context ===\n${truncate(userMemory, config.intentExtraction.sectionCharLimit)}` : '',
    ].filter(Boolean).join('\n\n');

    // 5. Call Protocol API via shared client
    console.log('[extract_intent] Calling Protocol API via client');
    const data = await callDiscoverNew(privyToken, { text: payload });

    // 6. Return structured response for widget
    return {
      content: [{
        type: 'text',
        text: `Extracted ${data.intentsGenerated} intent(s)`,
      }],
      structuredContent: {
        intents: data.intents,
        filesProcessed: data.filesProcessed || 0,
        linksProcessed: data.linksProcessed || 0,
        intentsGenerated: data.intentsGenerated,
      },
      _meta: {
        'openai/toolInvocation/invoked': `Extracted ${data.intentsGenerated} intents`,
      },
    };
  } catch (error) {
    console.error('Error extracting intents:', error);
    return {
      content: [{
        type: 'text',
        text: `Failed to extract intents: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }],
      isError: true,
    };
  }
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

    // 4. Generate summary text
    const summaryText =
      connections.length === 0
        ? 'No connections found.'
        : connections.length === 1
          ? 'Found 1 potential connection.'
          : `Found ${connections.length} potential connections.`;

    // 5. Return structured response for widget
    return {
      content: [{
        type: 'text',
        text: summaryText,
      }],
      structuredContent: {
        connections,
        intentsExtracted: intents.length,
        connectionsFound: connections.length,
      },
      _meta: {
        'openai/toolInvocation/invoked': summaryText,
      },
    };
  } catch (error) {
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
