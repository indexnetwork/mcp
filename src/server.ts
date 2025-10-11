import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { join } from "path";
import { readFileSync } from 'fs';

// Widget definition - reads built HTML at server startup
const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
const widgetHtmlPath = join(__dirname, '../widgets/dist/src/echo/index.html');
let widgetHtml = readFileSync(widgetHtmlPath, 'utf-8');

// Fix asset paths to point to server
widgetHtml = widgetHtml.replace(
  /src="\/echo-([^"]+)\.js"/g, 
  `src="${baseUrl}/widgets/echo-$1.js"`
);
widgetHtml = widgetHtml.replace(
  /href="\/echo-([^"]+)\.css"/g, 
  `href="${baseUrl}/widgets/echo-$1.css"`
);

/**
 * Echo widget configuration for ChatGPT integration
 */
const indexEchoWidget = {
  id: "index-echo",
  title: "Index Echo",
  templateUri: "ui://widget/index-echo.html",
  resourceName: "index-echo",
  invoking: "Rendering echo card",
  invoked: "Rendered echo card",
  mimeType: "text/html+skybridge",
  html: widgetHtml
};

/**
 * Embedded resource for OpenAI widget integration
 */
const indexEchoEmbeddedResource = {
  type: "resource" as const,
  resource: {
    uri: indexEchoWidget.templateUri,
    mimeType: indexEchoWidget.mimeType,
    text: indexEchoWidget.html,
    title: indexEchoWidget.title
  }
};

const server = new McpServer({
  name: "index-mcp-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});

server.registerResource(indexEchoWidget.resourceName, indexEchoWidget.templateUri, {}, async () => ({
  contents: [
    {
      uri: indexEchoWidget.templateUri,
      mimeType: indexEchoWidget.mimeType,
      text: indexEchoWidget.html,
      title: indexEchoWidget.title
    }
  ]
}));

// Single echo tool for testing
server.registerTool("echo", {
  title: "Echo Tool",
  description: "Echo back the provided message",
  inputSchema: { message: z.string() }
}, async ({ message }) => {
  return {
    content: [{ type: "text", text: `Echo: ${message}` }],
    structuredContent: { message },
    _meta: {
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
      "openai/outputTemplate": indexEchoWidget.templateUri,
      "openai/toolInvocation/invoking": indexEchoWidget.invoking,
      "openai/toolInvocation/invoked": indexEchoWidget.invoked,
      "openai.com/widget": indexEchoEmbeddedResource
    }
  };
});

// Universal intent extraction tool
server.registerTool("extract_intent", {
  title: "Analyze Conversation Intent",
  description: "Extracts and structures the user's goals, needs, or objectives from any conversation to help understand what they're trying to accomplish.",
  inputSchema: {
    intent: z.string().describe("What the user wants to achieve or accomplish"),
    category: z.enum(["hiring", "search", "research", "planning", "other"]).describe("Type of intent"),
    keywords: z.array(z.string()).describe("Important terms or concepts"),
    entities: z.array(z.string()).optional().describe("People, roles, skills, or specific things mentioned")
  },
  annotations: {
    readOnlyHint: true
  }
}, async ({ intent, category, keywords, entities }, { _meta }) => {
  // Comprehensive logging for testing
  console.log('\n=== INTENT EXTRACTION ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Intent:', intent);
  console.log('Category:', category);
  console.log('Keywords:', keywords);
  console.log('Entities:', entities);
  
  console.log('\n=== METADATA ===');
  console.log('Locale:', _meta?.["openai/locale"]);
  console.log('User Location:', _meta?.["openai/userLocation"]);
  console.log('Full _meta:', JSON.stringify(_meta, null, 2));
  console.log('========================\n');

  return {
    content: [{ 
      type: "text", 
      text: `Intent captured: ${intent}\nCategory: ${category}\nKeywords: ${keywords.join(', ')}`
    }],
    structuredContent: { 
      intent, 
      category,
      keywords, 
      entities,
      timestamp: new Date().toISOString()
    }
  };
});

const app = express();
app.use(express.json());
app.use(cors({
  origin: '*',
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'mcp-session-id'],
}));

app.use('/widgets', express.static(join(__dirname, '../widgets/dist')));

/**
 * Main MCP endpoint for stateless communication
 * Handles tool invocations and returns widget responses
 */
app.post('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// GET/DELETE not supported in stateless mode
app.get('/mcp', (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
});

app.delete('/mcp', (req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null
  });
});

const PORT = process.env.MCP_SERVER_PORT || 3002;
app.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`);
});

/**
 * MCP server instance for tool registration and communication
 */
export { server };

/**
 * Express application for serving MCP endpoints and widget assets
 */
export { app };
