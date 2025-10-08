import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { z } from "zod";

// Create MCP server instance
const server = new McpServer({
  name: "index-mcp-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {}
  }
});

// Register health check tool
server.registerTool("health-check", {
  title: "Health Check",
  description: "Check if the MCP server is running",
  inputSchema: {}
}, async () => ({
  content: [{ type: "text", text: "MCP Server is healthy and running!" }],
  _meta: {
    "openai/widgetAccessible": true
  }
}));

// Register echo tool for testing
server.registerTool("echo", {
  title: "Echo Tool", 
  description: "Echo back the provided message",
  inputSchema: { message: z.string() }
}, async ({ message }) => ({
  content: [{ type: "text", text: `Echo: ${message}` }],
  _meta: {
    "openai/widgetAccessible": true
  }
}));

// Register search tool for ChatGPT compatibility
server.registerTool("search", {
  title: "Search Tool",
  description: "Search for information or content",
  inputSchema: { 
    query: z.string().describe("Search query"),
    limit: z.number().optional().describe("Maximum number of results")
  }
}, async ({ query, limit = 5 }) => ({
  content: [{ 
    type: "text", 
    text: `Search results for "${query}":\n\n1. This is a sample search result\n2. Another result based on your query\n3. Search functionality is working!\n\n(Note: This is a demo search tool - ${limit} results shown)` 
  }],
  _meta: {
    "openai/widgetAccessible": true
  }
}));

// Register a resource for better tool discovery
server.registerResource(
  "index-info",
  "index://info",
  {
    title: "Index Information",
    description: "Information about the Index MCP server",
    mimeType: "text/plain"
  },
  async () => ({
    contents: [{
      uri: "index://info",
      text: "Index MCP Server\n\nAvailable tools:\n- health-check: Check server status\n- echo: Echo back messages\n- search: Search for information\n\nServer is running and ready for ChatGPT integration."
    }]
  })
);

// Create Express app
const app = express();
app.use(express.json());

// Configure CORS middleware for browser compatibility
app.use(cors({
  origin: '*', // Configure appropriately for production
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'mcp-session-id'],
}));

// Handle POST requests to /mcp endpoint
app.post('/mcp', async (req, res) => {
  try {
    // Create a new transport instance for each request (stateless mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect server to transport
    await server.connect(transport);
    
    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// GET requests not supported in stateless mode
app.get('/mcp', async (req, res) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

// DELETE requests not supported in stateless mode
app.delete('/mcp', async (req, res) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed."
    },
    id: null
  }));
});

// Start the server
const PORT = process.env.MCP_SERVER_PORT || 3002;

app.listen(PORT, () => {
  console.log(`MCP Server listening on port ${PORT}`);
  console.log(`Health check available at: http://localhost:${PORT}/mcp`);
});

export { server, app };
