# Index Network MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.12.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Project Status](https://img.shields.io/badge/status-development-yellow)](https://github.com/index-network/mcp)
[![MCP Version](https://img.shields.io/badge/MCP-1.19.1-blue)](https://github.com/modelcontextprotocol/typescript-sdk)

> A Model Context Protocol (MCP) server that enables ChatGPT integration with Index Network's discovery protocol.

This repository demonstrates Index Network's MCP server implementation, showcasing how to integrate with ChatGPT using React widgets and following best practices for MCP development.

**⚠️ Development Status**: This project is currently in active development and not yet production-ready. It serves as a reference implementation and development environment for MCP server development.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Security](#security)
- [How It Works](#how-it-works)
- [Adding New Widgets](#adding-new-widgets)
- [Widget Hooks](#widget-hooks)
- [Performance](#performance)
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
- 📦 **TypeScript 5.7.2** - Fully typed codebase for better development experience
- 🚀 **Development Ready** - Optimized builds with hashed assets and proper MCP protocol implementation
- 📝 **Clean Code** - Follows TypeScript commenting best practices with JSDoc documentation

## Quick Start

### Prerequisites

- **Node.js**: 22.12.0 or higher
- **Operating System**: macOS, Linux, or Windows (with WSL2 recommended)
- **Memory**: Minimum 2GB RAM (4GB recommended for development)
- **Port**: 3002 available (configurable via `MCP_SERVER_PORT`)
- **Network**: Internet access for npm packages and ngrok tunneling

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

### Advanced Usage Examples

#### Custom Widget Development

```typescript
// widgets/src/my-widget/MyWidget.tsx
import { useWidgetProps } from '../use-widget-props';
import { useOpenAiGlobal } from '../use-openai-global';

interface MyWidgetProps {
  title: string;
  data: any[];
}

export function MyWidget() {
  const props = useWidgetProps<MyWidgetProps>({ 
    title: '', 
    data: [] 
  });
  const theme = useOpenAiGlobal('theme');
  
  return (
    <div className={`widget ${theme}`}>
      <h3>{props.title}</h3>
      <ul>
        {props.data.map((item, index) => (
          <li key={index}>{item.name}</li>
        ))}
      </ul>
    </div>
  );
}
```

#### Environment Configuration

```bash
# Development
NODE_ENV=development npm run dev

# Production with custom port
MCP_SERVER_PORT=8080 NODE_ENV=production npm start

# With ngrok authtoken
NGROK_AUTHTOKEN=your_token npm run dev
```

## Security

### Vulnerability Checking

Regularly audit your dependencies for known vulnerabilities:

```bash
# Check for vulnerabilities
npm audit

# Fix automatically (use with caution)
npm audit fix

# Check for outdated packages
npm outdated
```

### Security Best Practices

- **Environment Variables**: Never commit sensitive data to version control
- **CORS Configuration**: The server uses permissive CORS (`origin: '*'`) for development - restrict in production
- **ngrok Tunnels**: Use authenticated ngrok sessions for production deployments
- **Dependencies**: Keep all dependencies up to date and audit regularly
- **HTTPS**: Always use HTTPS in production environments

### Development Security Checklist

- [ ] Set `NODE_ENV=development`
- [ ] Use ngrok for secure tunneling
- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Keep dependencies up to date
- [ ] Use environment variables for sensitive data
- [ ] Review CORS configuration for production readiness

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
  echo: './src/echo/index.html',
  myWidget: './src/my-widget/index.html'
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

## Performance

### Optimization Tips

- **Hot Reload**: Development changes are reflected in ~2 seconds
- **Build Optimization**: Vite provides fast builds with hashed assets for cache busting
- **Memory Usage**: Monitor memory consumption during development with `node --trace-sync-io`
- **Bundle Size**: Widgets are built as separate chunks for optimal loading

### Monitoring

```bash
# Monitor synchronous I/O operations
node --trace-sync-io dist/server.js

# Check memory usage
node --inspect dist/server.js
```

### Development Performance

- **Static Assets**: Widget assets are served with proper cache headers
- **Hot Reload**: Fast development iteration with Vite
- **Build Optimization**: Hashed assets for cache busting
- **Logging**: Console logging for development debugging

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

### Comment Best Practices

This project follows clean code commenting principles:

- **JSDoc for Public APIs**: All exported functions, classes, and types use JSDoc with `@param`, `@returns`, and `@example` tags
- **Self-Explanatory Code**: Prefer clear variable names and small functions over explanatory comments
- **Minimal Inline Comments**: Only use `//` comments for non-obvious business logic or architectural decisions
- **No Redundant Comments**: Avoid stating the obvious or repeating what the code already shows
- **Maintainable Documentation**: Keep comments in sync with code changes

Examples of good commenting practices can be found in:
- `widgets/src/use-widget-props.ts` - Comprehensive JSDoc with examples
- `widgets/src/use-widget-state.ts` - Real-world usage examples
- `src/server.ts` - JSDoc for exported items and route handlers

### Reporting Issues

Found a bug or have a feature request? Please:
1. Check existing issues first
2. Create a new issue with clear steps to reproduce
3. Include environment details (Node.js 22.12.0+, OS, etc.)

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