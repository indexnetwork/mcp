# ChatGPT App with OAuth2 + MCP + Privy

A complete ChatGPT App implementation using the OpenAI Apps SDK (MCP), with OAuth2 authentication via Privy.io.

## 🏗️ Architecture

- **Backend**: Express + MCP Server (TypeScript/Bun)
- **OAuth UI**: React + Privy + React Router
- **Widgets**: React components (rendered in ChatGPT)
- **Auth**: OAuth2 with PKCE + Privy.io
- **Package Manager**: Bun

## 📁 Project Structure

```
mcp2/
├── src/
│   ├── server/          # Express + MCP server
│   │   ├── oauth/       # OAuth2 endpoints
│   │   ├── mcp/         # MCP tools & resources
│   │   ├── api/         # Backend API integration
│   │   └── middleware/  # Auth middleware
│   ├── client/          # OAuth authorization UI
│   └── widgets/         # ChatGPT widget components
├── dist/
│   ├── client/          # Built OAuth UI
│   ├── widgets/         # Built widget bundles
│   └── server/          # Compiled server
└── package.json
```

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) installed
- [Privy.io](https://privy.io/) account and app created
- OpenSSL (for generating JWT keys)

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Generate JWT Keys

```bash
# Generate RSA key pair for JWT signing
openssl genrsa -out private-key.pem 2048
openssl rsa -in private-key.pem -pubout -out public-key.pem

# Base64 encode for .env
echo "JWT_PRIVATE_KEY=$(cat private-key.pem | base64)"
echo "JWT_PUBLIC_KEY=$(cat public-key.pem | base64)"

# Clean up PEM files
rm private-key.pem public-key.pem
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values:
# - PRIVY_APP_ID (from Privy dashboard)
# - PRIVY_APP_SECRET (from Privy dashboard)
# - JWT_PRIVATE_KEY (from step 3)
# - JWT_PUBLIC_KEY (from step 3)
# - BACKEND_API_URL (your existing backend)
```

### 5. Build & Run

**IMPORTANT**: Widgets must be built before starting the server!

```bash
# First time: Build widgets (required!)
bun run build:widgets

# Then start development server
bun run dev
```

The server will start at `http://localhost:3002`

## 🔧 Development

### Understanding the Widget Build Process

⚠️ **Key Point**: `bun run dev` does **NOT** automatically build widgets. You must build them separately!

There are three development workflows:

#### Option 1: Manual Build (Recommended for first-time setup)
```bash
# 1. Build widgets once
bun run build:widgets

# 2. Start server with auto-reload
bun run dev

# 3. Rebuild widgets manually when you change widget code
bun run build:widgets
```

#### Option 2: Watch Mode (Recommended for active widget development)
```bash
# Terminal 1: Build widgets in watch mode (auto-rebuilds on changes)
bun run dev:widgets

# Terminal 2: Run server with auto-reload
bun run dev
```

#### Option 3: Run Everything (Most convenient)
```bash
# Runs both server AND widget watch mode simultaneously
bun run dev:all
```

### Other Development Commands

```bash
# Type check
bun run type-check

# Run tests
bun run test

# Build everything for production
bun run build
```

### Project Configuration

**Server**: [src/server/index.ts](src/server/index.ts)
- OAuth endpoints: `/authorize`, `/token`, `/.well-known/*`
- MCP endpoint: `/mcp`
- Health check: `/health`

**OAuth UI**: [src/client/src/App.tsx](src/client/src/App.tsx)
- Authorization page with Privy login
- Consent screen
- Built with Vite + React + React Router

**Widgets**: [src/widgets/src/](src/widgets/src/)
- ListView: Interactive list with actions
- Built as standalone bundles
- Communicate via `window.openai` API

## 🧪 Testing

### Test with MCP Inspector

```bash
# Terminal 1: Run server
bun run dev

# Terminal 2: Run MCP Inspector
bunx @modelcontextprotocol/inspector http://localhost:3002/mcp
```

### Test with ngrok

```bash
# Expose local server
ngrok http 3002

# Copy the HTTPS URL (e.g., https://abc123.ngrok.app)
# Use this URL in ChatGPT Settings → Connectors
```

### Connect to ChatGPT

1. **Enable Developer Mode**:
   - ChatGPT Settings → Apps & Connectors → Advanced settings
   - Enable "Developer mode"

2. **Create Connector**:
   - Settings → Connectors → Create
   - Name: "Your App Name"
   - Description: "What your app does"
   - Connector URL: `https://your-server.com/mcp` (or ngrok URL)

3. **Test OAuth Flow**:
   - Start a new ChatGPT conversation
   - Click + → More → Select your connector
   - You'll be redirected to `/authorize`
   - Log in with Privy
   - Grant consent
   - ChatGPT receives OAuth token

4. **Test Tools**:
   - Ask ChatGPT: "Show me my items"
   - The `get-items` tool will be called
   - Widget will render in ChatGPT

## 📦 Production Build

```bash
# Build everything
bun run build

# Run production server
bun run start

# Or preview locally
bun run preview
```

### Docker Deployment

```bash
# Build image
docker build -t chatgpt-app .

# Run container
docker run -p 3000:3000 --env-file .env chatgpt-app
```

### Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Create app
fly launch

# Set secrets
fly secrets set PRIVY_APP_ID=xxx
fly secrets set PRIVY_APP_SECRET=xxx
fly secrets set JWT_PRIVATE_KEY=xxx
fly secrets set JWT_PUBLIC_KEY=xxx
fly secrets set BACKEND_API_URL=xxx

# Deploy
fly deploy
```

## 🔐 OAuth2 Flow

1. **ChatGPT** redirects user to `/authorize?client_id=...&code_challenge=...`
2. **Server** serves React UI (Privy login)
3. **User** authenticates with Privy
4. **Frontend** shows consent screen
5. **User** approves, server generates authorization code
6. **Frontend** redirects back to ChatGPT with code
7. **ChatGPT** exchanges code for access token at `/token`
8. **Server** validates PKCE, issues JWT
9. **ChatGPT** uses JWT for `/mcp` requests

## 🎨 Adding New Tools

### 1. Define Tool in [src/server/mcp/tools.ts](src/server/mcp/tools.ts)

```typescript
{
  name: 'my-new-tool',
  description: 'What the tool does',
  inputSchema: {
    type: 'object',
    properties: {
      param: { type: 'string' }
    },
    required: ['param']
  }
}
```

### 2. Implement Handler

```typescript
async function handleMyNewTool(args: any, auth: any) {
  // Validate auth
  // Call backend API
  // Return structured response
}
```

### 3. Link to Widget (Optional)

```typescript
_meta: {
  'openai/outputTemplate': 'ui://widget/my-widget.html',
}
```

## 🎨 Adding New Widgets

### 1. Create Widget Component

```bash
mkdir -p src/widgets/src/MyWidget
```

### 2. Build Widget

```typescript
// src/widgets/src/MyWidget/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MyWidget } from './MyWidget';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<MyWidget />);
```

### 3. Configure Vite

```typescript
// Update src/widgets/vite.config.ts
build: {
  lib: {
    entry: {
      'my-widget': 'src/MyWidget/index.tsx'
    }
  }
}
```

### 4. Register Resource

```typescript
// src/server/mcp/resources.ts
await registerMyWidget(server, widgetPath);
```

## 📚 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PRIVY_APP_ID` | Your Privy app ID | ✅ |
| `PRIVY_APP_SECRET` | Your Privy app secret | ✅ |
| `VITE_PRIVY_APP_ID` | Privy app ID (for frontend) | ✅ |
| `JWT_PRIVATE_KEY` | Base64-encoded RSA private key | ✅ |
| `JWT_PUBLIC_KEY` | Base64-encoded RSA public key | ✅ |
| `SERVER_BASE_URL` | Your server URL | ✅ |
| `BACKEND_API_URL` | Your existing backend URL | ✅ |
| `PORT` | Server port (default: 3000) | ❌ |
| `NODE_ENV` | Environment (development/production) | ❌ |

## 🐛 Troubleshooting

### Widgets not loading

```bash
# Build widgets first
bun run build:widgets

# Restart server
bun run dev
```

### OAuth flow fails

- Check `SERVER_BASE_URL` matches your actual URL
- Verify Privy app ID is correct
- Check JWT keys are properly base64-encoded
- Ensure redirect URI is registered in ChatGPT

### Token validation fails

- Verify JWT keys are correct (public/private pair)
- Check token hasn't expired (1 hour default)
- Ensure `aud` claim matches your server URL

### MCP Inspector can't connect

```bash
# Ensure server is running
bun run dev

# Try:
bunx @modelcontextprotocol/inspector http://localhost:3002/mcp
```

## 📖 Resources

- [OpenAI Apps SDK Docs](https://developers.openai.com/apps-sdk/)
- [MCP Specification](https://modelcontextprotocol.io/)
- [Privy Docs](https://docs.privy.io/)
- [Bun Docs](https://bun.sh/docs)

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.
