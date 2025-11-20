/**
 * MCP Widget Resource Registration
 * Loads and registers widget HTML resources
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { join } from 'path';

// Widget registry to store loaded widgets (just metadata, files served via HTTP)
const widgetRegistry = new Map<string, { name: string; description: string }>();

/**
 * Get widget metadata for a given URI
 */
function getWidgetMeta(uri: string) {
  // Map widget URIs to their metadata
  const metadataMap: Record<string, any> = {
    'ui://widget/list-view.html': {
      'openai/outputTemplate': 'ui://widget/list-view.html',
      'openai/toolInvocation/invoking': 'Loading items...',
      'openai/toolInvocation/invoked': 'Items loaded',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
    },
    'ui://widget/echo.html': {
      'openai/outputTemplate': 'ui://widget/echo.html',
      'openai/toolInvocation/invoking': 'Echoing...',
      'openai/toolInvocation/invoked': 'Echo complete',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
    },
    'ui://widget/intent-display.html': {
      'openai/outputTemplate': 'ui://widget/intent-display.html',
      'openai/toolInvocation/invoking': 'Extracting intents...',
      'openai/toolInvocation/invoked': 'Intents extracted',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
    },
    'ui://widget/discover-connections.html': {
      'openai/outputTemplate': 'ui://widget/discover-connections.html',
      'openai/toolInvocation/invoking': 'Finding potential connections...',
      'openai/toolInvocation/invoked': 'Found potential connections',
      'openai/widgetAccessible': true,
      'openai/resultCanProduceWidget': true,
    },
  };

  return metadataMap[uri] || {};
}

/**
 * Register all widget resources with the MCP server
 * Widgets are built React components bundled as standalone JS/CSS
 */
export async function registerWidgetResources(server: Server) {
  const widgetPath = join(process.cwd(), 'dist/widgets');

  // Verify widget files exist (they'll be served via HTTP static middleware)
  const cssExists = existsSync(join(widgetPath, 'mcp2.css'));
  const sharedJSFile = require('fs').readdirSync(widgetPath)
    .find((f: string) => f.startsWith('useOpenAi-') && f.endsWith('.js'));

  if (cssExists) {
    console.log('✓ Found widget CSS');
  }
  if (sharedJSFile) {
    console.log(`✓ Found shared widget JS: ${sharedJSFile}`);
  }

  // Define widgets to register
  const widgets = [
    {
      fileName: 'list-view',
      uri: 'ui://widget/list-view.html',
      name: 'ListView Widget',
      description: 'Interactive list view with actions',
    },
    {
      fileName: 'echo',
      uri: 'ui://widget/echo.html',
      name: 'Echo Widget',
      description: 'Simple echo widget that displays text',
    },
    {
      fileName: 'intent-display',
      uri: 'ui://widget/intent-display.html',
      name: 'IntentDisplay Widget',
      description: 'Displays extracted intents with archive/delete actions',
    },
    {
      fileName: 'discover-connections',
      uri: 'ui://widget/discover-connections.html',
      name: 'DiscoverConnections Widget',
      description: 'Displays discovered connections with synthesis summaries',
    },
  ];

  // Load all widgets
  for (const widget of widgets) {
    const widgetFilePath = join(widgetPath, `${widget.fileName}.js`);
    if (existsSync(widgetFilePath)) {
      await loadWidget(widgetPath, widget.fileName, widget.name, widget.description);
    } else {
      console.warn(`⚠️  ${widget.name} not found at ${widgetFilePath}`);
      console.warn(`   Run \`bun run build:widgets\` to build widgets.`);
    }
  }

  // Register resource handlers
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;

    // Find widget by URI
    for (const [widgetUri, widgetData] of widgetRegistry.entries()) {
      if (uri === widgetUri) {
        // Extract widget filename from URI (e.g., "ui://widget/echo.html" -> "echo")
        const widgetFileName = uri.split('/').pop()?.replace('.html', '') || 'unknown';

        return {
          contents: [
            {
              uri: widgetUri,
              mimeType: 'text/html+skybridge',
              text: createWidgetHTML(widgetData.name, widgetFileName),
              _meta: getWidgetMeta(widgetUri),
            },
          ],
        };
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  // Register resources list handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = Array.from(widgetRegistry.entries()).map(([uri, data]) => ({
      uri,
      name: data.name,
      description: data.description,
      mimeType: 'text/html+skybridge',
    }));

    return { resources };
  });

  console.log(`✓ Registered ${widgetRegistry.size} widget(s)`);
}

/**
 * Register a widget (files are served via HTTP, not loaded into memory)
 */
async function loadWidget(
  widgetPath: string,
  fileName: string,
  name: string,
  description: string
) {
  try {
    // Just verify the JS file exists
    const widgetJSPath = join(widgetPath, `${fileName}.js`);
    if (!existsSync(widgetJSPath)) {
      throw new Error(`Widget JS file not found: ${widgetJSPath}`);
    }

    // Add to registry (just metadata - actual files served via HTTP)
    const uri = `ui://widget/${fileName}.html`;
    widgetRegistry.set(uri, {
      name,
      description,
    });

    console.log(`✓ Registered ${name}`);
  } catch (error) {
    console.error(`Failed to register ${name}:`, error);
  }
}

/**
 * Create the complete HTML for a widget
 * Uses external script/link tags pointing to HTTP-served assets
 * The widget JS will automatically import its dependencies via ES modules
 */
function createWidgetHTML(title: string, widgetFileName: string): string {
  const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <link rel="stylesheet" crossorigin href="${baseUrl}/widgets/mcp2.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" crossorigin src="${baseUrl}/widgets/${widgetFileName}.js"></script>
  </body>
</html>
  `.trim();
}
