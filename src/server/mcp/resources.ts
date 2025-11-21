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
import { WIDGETS } from './widgetConfig.js';

// Widget registry to store loaded widgets (just metadata, files served via HTTP)
const widgetRegistry = new Map<string, { name: string; description: string }>();

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

  // Load all widgets from WIDGETS config
  for (const config of Object.values(WIDGETS)) {
    const widgetFilePath = join(widgetPath, `${config.fileName}.js`);
    if (existsSync(widgetFilePath)) {
      await loadWidget(widgetPath, config.fileName, config.title, config.description);
    } else {
      console.warn(`⚠️  ${config.title} not found at ${widgetFilePath}`);
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

        // Find widget config to get resource metadata (if any)
        const widgetConfig = Object.values(WIDGETS).find(w => w.uri === widgetUri);
        const resourceMeta = widgetConfig?.resourceMeta || {};

        return {
          contents: [
            {
              uri: widgetUri,
              mimeType: 'text/html+skybridge',
              text: createWidgetHTML(widgetData.name, widgetFileName),
              // Resource-level metadata only (tool metadata is in tools.ts)
              _meta: resourceMeta,
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
