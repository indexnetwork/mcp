# Index Network MCP Server

Minimal Model Context Protocol (MCP) server for ChatGPT integration with Index Network.

## Quick Start

### Prerequisites
- Node.js 18+
- ngrok account ([sign up free](https://ngrok.com))

### Setup
```bash
npm install
cp env.example .env
# Edit .env with your NGROK_AUTHTOKEN
```

### Run
```bash
./src/start-mcp.sh
```

This starts the MCP server, creates an ngrok tunnel, and launches the MCP Inspector.

## ChatGPT Integration

1. Run `./src/start-mcp.sh`
2. Copy the ngrok URL (e.g., `https://abc123.ngrok-free.dev/mcp`)
3. Add to ChatGPT as an MCP server

## Available Tool

### `echo`
Echoes back the provided message.

**Parameters:**
- `message` (string): Message to echo

**Example:**
```json
{
  "message": "Hello, Index!"
}
```

## Configuration

Set in `.env`:
- `MCP_SERVER_PORT` - Server port (default: 3002)
- `NGROK_AUTHTOKEN` - Your ngrok auth token

## Links

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Index Network](https://index.network)