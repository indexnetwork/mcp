# Index Network MCP Server

A Model Context Protocol (MCP) server for Index Network ChatGPT integration with React-based widgets.

## Architecture

This project follows the Apps SDK Examples Gallery pattern with a React + Vite build system for ChatGPT widgets:

- **MCP Server** (`src/server.ts`) - Express server exposing tools via MCP protocol
- **Widgets** (`widgets/`) - React components built with Vite for rich UI in ChatGPT
- **Shared Hooks** (`widgets/src/hooks/`) - Reusable hooks for widget development

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

1. Install dependencies:
```bash
npm install
cd widgets && npm install
```

2. Start development servers:
```bash
npm run dev
```

This runs both the MCP server and widget dev server concurrently.

### Widget Development

Widgets are React components in the `widgets/src/` directory:

- **Components** - React components with proper JSX and TypeScript
- **Styles** - Separate CSS files with full IDE support
- **Hooks** - Utilities following OpenAI pattern:
  - `use-widget-props.ts` - Access tool output data
  - `use-openai-global.ts` - Read ChatGPT environment (theme, locale, etc.)
  - `use-widget-state.ts` - Manage persistent widget state

### Adding New Widgets

1. Create widget directory: `widgets/src/your-widget/`
2. Add React component: `YourWidget.tsx`
3. Add styles: `your-widget.css`
4. Add entry point: `index.tsx` and `index.html`
5. Update `vite.config.ts` to include new entry point
6. Add widget definition inline in `server.ts` (following OpenAI pattern)

### Building

```bash
# Build widgets and MCP server
npm run build

# Build widgets only
npm run build:widgets
```

Built widgets are output to `widgets/dist/` with hashed filenames for cache busting.

## Production Deployment

1. Build the project: `npm run build`
2. Start the server: `npm start`
3. Expose via ngrok for ChatGPT testing:
```bash
ngrok http 3002
```

Add the ngrok URL to ChatGPT connectors: `https://your-ngrok-url.ngrok-free.app/mcp`

## Widget Integration

Widgets are served as embedded resources with the `text/html+skybridge` MIME type. The MCP server:

1. Registers widget resources
2. Serves static assets via `/widgets/` endpoint
3. Returns widget HTML in tool responses with proper metadata

## Tools

- **echo** - Echo tool that renders the Index Echo widget
  - Input: `{ message: string }`
  - Output: Renders echo card with message

## File Structure

```
mcp/
├── src/
│   └── server.ts              # MCP server with inline widget definitions
├── widgets/                   # Widget build system
│   ├── src/
│   │   ├── use-widget-props.ts
│   │   ├── use-openai-global.ts
│   │   ├── use-widget-state.ts
│   │   └── echo/              # Echo widget
│   │       ├── Echo.tsx       # React component
│   │       ├── echo.css       # Styles
│   │       ├── index.tsx      # Entry point
│   │       └── index.html     # HTML template
│   ├── dist/                  # Built widget bundles
│   ├── package.json
│   └── vite.config.ts
└── package.json
```

## References

- [Apps SDK Examples Gallery](https://github.com/openai/apps-sdk-examples-gallery)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [OpenAI Apps SDK](https://platform.openai.com/docs/guides/apps)