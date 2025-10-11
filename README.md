# Index Network MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> A Model Context Protocol (MCP) server that enables ChatGPT integration with Index Network's discovery protocol.

This repository demonstrates Index Network's MCP server implementation, showcasing how to integrate with ChatGPT using React widgets and following best practices for MCP development.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Adding New Widgets](#adding-new-widgets)
- [Widget Hooks](#widget-hooks)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)
- [References](#references)

## Features

- 🔥 **Hot Reload** - Edit widgets and see changes instantly in development
- ⚡ **Modern Tooling** - Vite + React for fast builds and optimal performance
- 🎨 **Custom Hooks** - `useWidgetProps`, `useOpenAiGlobal`, `useWidgetState` for seamless ChatGPT integration
- 🛠️ **MCP Inspector** - Test and debug widgets without ChatGPT integration
- 📦 **TypeScript** - Fully typed codebase for better development experience
- 🚀 **Production Ready** - Optimized builds with hashed assets and proper MCP protocol implementation

## Quick Start

### Prerequisites

- Node.js 18+
- Port 3002 available

### Installation

```bash
npm install
cd widgets && npm install && cd ..

# Configure environment
cp env.example .env
# Edit .env with your ngrok authtoken (optional)
```

### Development

```bash
npm run dev
```

This starts Vite in watch mode and the MCP server with auto-restart. Edit `widgets/src/echo/echo.css` → save → see changes in ~2 seconds.

### Testing

```bash
npm test  # Launches MCP Inspector
```

## Usage

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_SERVER_PORT` | Server port | `3002` |
| `NGROK_AUTHTOKEN` | ngrok auth token | Required |
| `NODE_ENV` | Environment | `development` |

**Get ngrok authtoken:** Sign up at [ngrok.com](https://ngrok.com/), then run `ngrok config add-authtoken YOUR_TOKEN`

### Connect to ChatGPT

1. Build: `npm run build`
2. Start: `npm start`
3. Expose: `ngrok http 3002` (or set `NGROK_AUTHTOKEN` in `.env`)
4. Configure ChatGPT with: `https://your-url.ngrok-free.app/mcp`

### Example Tool

```
Use the echo tool to display "Hello, World!"
```

## How It Works

### Architecture

```
src/server.ts          # MCP server with tool registration
widgets/src/           # React widgets with hooks
widgets/dist/          # Built assets (hashed filenames)
```

### Hot Reload Pipeline

```
File change → Vite rebuild → Nodemon restart → Updated widget
```

Key files:
- `nodemon.json` - File watching config
- `widgets/vite.config.ts` - Build config
- `package.json` - Scripts and dependencies

## Adding New Widgets

### 1. Create Widget

```bash
mkdir widgets/src/my-widget
```

Create:
- `MyWidget.tsx` - React component
- `my-widget.css` - Styles
- `index.tsx` - Entry point
- `index.html` - Template with `<div id="my-widget-root">`

### 2. Update Vite Config

Add entry in `widgets/vite.config.ts`:

```typescript
input: {
  echo: resolve(__dirname, 'src/echo/index.html'),
  myWidget: resolve(__dirname, 'src/my-widget/index.html')
}
```

### 3. Register Tool

In `src/server.ts`:

```typescript
const myWidgetHtml = readFileSync(
  join(__dirname, '../widgets/dist/src/my-widget/index.html'),
  'utf-8'
);

server.registerTool("my-tool", {
  title: "My Tool",
  description: "Tool description",
  inputSchema: z.object({ data: z.string() })
}, async (params) => ({
  content: [{ type: "text", text: "Result" }],
  structuredContent: params,
  _meta: {
    "openai/widgetAccessible": true,
    "openai.com/widget": {
      type: "resource",
      resource: {
        uri: "ui://widget/my-widget.html",
        mimeType: "text/html+skybridge",
        text: myWidgetHtml
      }
    }
  }
}));
```

## Widget Hooks

```typescript
import { useWidgetProps } from '../use-widget-props';
import { useOpenAiGlobal } from '../use-openai-global';
import { useWidgetState } from '../use-widget-state';

function MyWidget() {
  const props = useWidgetProps<{ message: string }>();
  const theme = useOpenAiGlobal('theme');
  const [state, setState] = useWidgetState({ count: 0 });
  
  return <div>{props.message}</div>;
}
```

## Troubleshooting

### Common Issues

**Port 3002 already in use?**
```bash
# Kill process using port 3002
lsof -ti:3002 | xargs kill -9

# Or use a different port
MCP_SERVER_PORT=3003 npm run dev
```

**Hot reload not working?**
- Check terminal for `[nodemon] restarting due to changes...`
- Ensure Vite is running: `cd widgets && npm run dev`
- Clear build cache: `rm -rf widgets/dist && npm run build`

**Widget not displaying in ChatGPT?**
- Verify ngrok tunnel is active: `ngrok http 3002`
- Check MCP endpoint is accessible: `curl https://your-url.ngrok-free.app/mcp`
- Ensure widget HTML is built: `npm run build`

**TypeScript errors?**
- Run type check: `npm run type-check`
- Clear TypeScript cache: `rm -rf node_modules/.cache`
- Reinstall dependencies: `rm -rf node_modules && npm install`

**Environment variables not loading?**
- Ensure `.env` file exists: `cp env.example .env`
- Check variable names match exactly (case-sensitive)
- Restart the development server after changes

## Contributing

We welcome contributions to improve Index Network's MCP server! Here's how to get started:

### Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/index-network-mcp.git`
3. Install dependencies: `npm install && cd widgets && npm install && cd ..`
4. Create a feature branch: `git checkout -b feature/your-feature-name`
5. Make your changes following our coding standards
6. Submit a pull request with a clear description

### Coding Standards

- Use TypeScript for all new code
- Follow existing code style and patterns
- Add tests for new functionality
- Update documentation as needed
- Ensure all linting passes: `npm run lint`

### Reporting Issues

Found a bug or have a feature request? Please:
1. Check existing issues first
2. Create a new issue with clear steps to reproduce
3. Include environment details (Node.js version, OS, etc.)

## Support

Need help? Here are your options:

- **Documentation**: Check this README and the [References](#references) section
- **Issues**: Report bugs or request features via [GitHub Issues](https://github.com/index-network/mcp/issues)
- **Community**: Join the Index Network community at [index.network](https://index.network)
- **Email**: Contact us at [hello@index.network](mailto:hello@index.network)

## License

MIT - See [LICENSE](LICENSE)

## References

- [Index Network](https://index.network) - Discovery protocol for web3
- [ngrok](https://ngrok.com/) - Secure tunneling to localhost
- [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/) - Framework for building ChatGPT apps
- [OpenAI Apps SDK Examples](https://github.com/openai/openai-apps-sdk-examples) - Example implementations
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) - Official MCP SDK
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) - Visual testing tool for MCP servers