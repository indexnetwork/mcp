/**
 * MCP Server Initialization
 * Creates and configures the Model Context Protocol server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';
import { registerWidgetResources } from './resources.js';

let mcpServer: Server | null = null;

/**
 * Initialize the MCP server
 * This is called when the Express server starts
 */
export async function initializeMCPServer(): Promise<Server> {
  if (mcpServer) {
    return mcpServer;
  }

  console.log('Initializing MCP server...');

  // Create MCP server instance
  mcpServer = new Server(
    {
      name: 'chatgpt-app-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Register widget resources first (tools reference them)
  await registerWidgetResources(mcpServer);
  console.log('✓ Widget resources registered');

  // Register MCP tools
  registerTools(mcpServer);
  console.log('✓ MCP tools registered');

  console.log('✓ MCP server initialized');

  return mcpServer;
}

/**
 * Get the initialized MCP server instance
 */
export function getMCPServer(): Server {
  if (!mcpServer) {
    throw new Error('MCP server not initialized. Call initializeMCPServer() first.');
  }
  return mcpServer;
}

