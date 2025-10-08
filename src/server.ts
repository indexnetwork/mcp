import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import cors from "cors";
import { z } from "zod";

type StoredProfile = {
  displayName?: string;
  pronouns?: string;
  preferences?: string;
  notes?: string;
  updatedAt: string;
};

const profileStore = new Map<string, StoredProfile>();

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

server.registerTool("store-user-profile", {
  title: "Store User Profile Snippet",
  description: "Persist profile details only after the user explicitly consents. Call this tool with the fields the user approved.",
  inputSchema: {
    profileKey: z.string().min(1, "profileKey is required").describe("Stable identifier supplied by the user (e.g. email or handle)"),
    consentGranted: z.boolean().describe("True only if the user explicitly agreed to store this info in the current conversation"),
    displayName: z.string().min(1).optional().describe("Preferred display name"),
    pronouns: z.string().min(1).optional().describe("Pronouns or honorifics to use"),
    preferences: z.string().min(1).optional().describe("Persona, tone, or workflow preferences"),
    notes: z.string().min(1).optional().describe("Free-form notes shared by the user for future reference")
  }
}, async (args) => {
  if (!args.consentGranted) {
    return {
      content: [{
        type: "text",
        text: "Consent was not granted. Nothing was stored."
      }],
      _meta: {
        "openai/widgetAccessible": true
      }
    };
  }

  const { profileKey, consentGranted: _consentGranted, ...rest } = args;
  const fields = Object.entries(rest).filter(([_, value]) => typeof value === "string" && value.trim().length > 0);

  if (fields.length === 0) {
    return {
      content: [{
        type: "text",
        text: "No profile fields were provided. Please include at least one value to store."
      }],
      _meta: {
        "openai/widgetAccessible": true
      }
    };
  }

  const existing = profileStore.get(profileKey) ?? {};
  const updated: StoredProfile = {
    ...existing,
    ...Object.fromEntries(fields),
    updatedAt: new Date().toISOString()
  };

  profileStore.set(profileKey, updated);

  return {
    content: [{
      type: "text",
      text: `Stored profile for "${profileKey}". Fields saved: ${fields.map(([key]) => key).join(", ")}.`
    }],
    _meta: {
      "openai/widgetAccessible": true
    }
  };
});

server.registerTool("get-user-profile", {
  title: "Get Stored User Profile",
  description: "Retrieve previously stored profile fields using the profileKey the user provided.",
  inputSchema: {
    profileKey: z.string().min(1).describe("Identifier used when storing the profile")
  }
}, async ({ profileKey }) => {
  const stored = profileStore.get(profileKey);

  if (!stored) {
    return {
      content: [{
        type: "text",
        text: `No profile data found for "${profileKey}".`
      }],
      _meta: {
        "openai/widgetAccessible": true
      }
    };
  }

  const { updatedAt, ...visible } = stored;
  const lines = Object.entries(visible).map(([key, value]) => `- ${key}: ${value}`);

  return {
    content: [{
      type: "text",
      text: `Profile for "${profileKey}" (last updated ${updatedAt}):\n${lines.join("\n")}`
    }],
    _meta: {
      "openai/widgetAccessible": true
    }
  };
});

server.registerTool("delete-user-profile", {
  title: "Delete Stored User Profile",
  description: "Erase any stored profile data after the user requests deletion.",
  inputSchema: {
    profileKey: z.string().min(1).describe("Identifier used when storing the profile"),
    confirm: z.boolean().describe("Must be true if the user explicitly requested deletion")
  }
}, async ({ profileKey, confirm }) => {
  if (!confirm) {
    return {
      content: [{
        type: "text",
        text: "Deletion not confirmed. No data was removed."
      }],
      _meta: {
        "openai/widgetAccessible": true
      }
    };
  }

  const removed = profileStore.delete(profileKey);

  return {
    content: [{
      type: "text",
      text: removed
        ? `Deleted stored profile data for "${profileKey}".`
        : `No stored profile data existed for "${profileKey}".`
    }],
    _meta: {
      "openai/widgetAccessible": true
    }
  };
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

server.registerResource(
  "index-privacy",
  "index://privacy",
  {
    title: "Index MCP Privacy & Consent Policy",
    description: "Details on how user-shared memories are stored and cleared.",
    mimeType: "text/plain"
  },
  async () => ({
    contents: [{
      uri: "index://privacy",
      text: [
        "Index MCP Privacy Overview",
        "",
        "- We only store profile fields after the user explicitly consents in the current conversation.",
        "- Stored data is keyed by the profileKey the user supplied and lives in volatile server memory.",
        "- Use delete-user-profile with confirm=true to erase the stored fields immediately.",
        "- Restarting the server clears all stored data; no information is written to disk."
      ].join("\n")
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
