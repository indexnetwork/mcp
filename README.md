# Index Network MCP Server

A Model Context Protocol (MCP) server that enables ChatGPT integration with Index Network's discovery protocol.

## Features

- 🚀 **Quick Setup**: One-command startup with included script
- 🔧 **MCP Tools**: Health check, echo, and search functionality
- 🌐 **Public Access**: Built-in ngrok integration for external access
- 🧪 **Testing**: MCP Inspector integration for easy testing

## Quick Start

### Prerequisites

- Node.js 18+
- ngrok account ([sign up free](https://ngrok.com))

### Installation

```bash
# Clone and setup
git clone https://github.com/indexnetwork/mcp.git
cd mcp
npm install

# Configure environment
cp env.example .env
# Edit .env with your ngrok authtoken
```

### Run Everything at Once

```bash
# Start server, ngrok tunnel, and inspector
./src/start-mcp.sh
```

The script will:
- Start the MCP server on port 3002
- Create an ngrok tunnel (public URL)
- Launch MCP Inspector for testing
- Display all URLs and process IDs

### Manual Setup (Alternative)

```bash
# Terminal 1: Start server
npm run dev

# Terminal 2: Create tunnel
ngrok http 3002

# Terminal 3: Test with inspector
npx @modelcontextprotocol/inspector@latest
# Enter: http://localhost:3002/mcp
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_SERVER_PORT` | Server port | `3002` |
| `NGROK_AUTHTOKEN` | ngrok auth token | Required |
| `NODE_ENV` | Environment | `development` |

### ngrok Setup

1. Get your authtoken from [ngrok dashboard](https://dashboard.ngrok.com)
2. Add to `.env`:
   ```bash
   NGROK_AUTHTOKEN=your_token_here
   ```

## Available Tools

### `health-check`
Check server status.

### `echo`
Echo back a message.

### `search`
Search functionality (demo implementation).

## ChatGPT Integration

1. Run the startup script: `./src/start-mcp.sh`
2. Copy the ngrok URL from the output (e.g., `https://abc123.ngrok-free.dev/mcp`)
3. Configure ChatGPT to use this MCP server URL

## Development

### Project Structure

```
mcp/
├── src/
│   ├── server.ts          # MCP server implementation
│   └── start-mcp.sh       # Startup script
├── docs/                  # Documentation
├── package.json           # Dependencies
└── README.md             # This file
```

### Adding Tools

```typescript
server.registerTool("my-tool", {
  title: "My Tool",
  description: "Tool description",
  inputSchema: z.object({
    input: z.string()
  })
}, async (params) => ({
  content: [{ type: "text", text: "Result" }],
  _meta: { "openai/widgetAccessible": true }
}));
```

### Building

```bash
npm run build    # Compile TypeScript
npm start        # Run production build
```

## Troubleshooting

**Script won't run**
- Make executable: `chmod +x src/start-mcp.sh`
- Check Node.js version: `node --version` (needs 18+)

**ngrok errors**
- Verify authtoken in `.env`
- Check if port 3002 is available

**MCP Inspector issues**
- Ensure server is running first
- Use correct URL: `http://localhost:3002/mcp`

## Links

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Index Network](https://index.network)
- [ngrok](https://ngrok.com)

## License

MIT License - see [LICENSE](LICENSE) for details.