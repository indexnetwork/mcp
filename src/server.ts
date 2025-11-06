import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { z } from "zod";
import { join } from "path";
import { readFileSync, existsSync } from 'fs';
import {
  authenticatePrivy,
  type AuthenticatedRequest
} from "./auth";
import type { TokenEndpointResponse } from "./oauth";
import {
  type AuthorizationPageContext,
  authorizationServerMetadata,
  completeAuthorization,
  exchangeCodeForTokens,
  prepareAuthorization,
  protectedResourceMetadata,
  refreshAccessToken,
  registerClient,
  revokeToken,
  serializeAuthorizationContext,
  listSupportedScopes
} from "./oauth";

// Widget definition - reads built HTML at server startup
const baseUrl = process.env.MCP_SERVER_URL || 'http://localhost:3002';
const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
const widgetHtmlPrimaryPath = join(__dirname, '../widgets/dist/widgets/index.html');
const widgetHtmlFallbackPath = join(__dirname, '../widgets/dist/src/echo/index.html');
const consentHtmlPrimaryPath = join(__dirname, '../widgets/dist/oauth/index.html');
const consentHtmlFallbackPath = join(__dirname, '../widgets/dist/src/oauth-consent/index.html');

function readFileWithFallback(primary: string, fallback: string) {
  if (existsSync(primary)) {
    return readFileSync(primary, 'utf-8');
  }
  if (existsSync(fallback)) {
    return readFileSync(fallback, 'utf-8');
  }
  throw new Error(`Missing required asset. Checked:\n - ${primary}\n - ${fallback}`);
}

let widgetHtml = readFileWithFallback(widgetHtmlPrimaryPath, widgetHtmlFallbackPath);
//TODO!: Get item from MEMORY. Implemented needs to be tested.

function rewriteAssetUrls(html: string, route: string) {
  return html.replace(
    /(src|href)="\/([^"]+)"/g,
    (_match, attr: string, path: string) => {
      const suffix = path.startsWith(`${route}/`) ? path.slice(route.length + 1) : path;
      const normalizedPath = suffix ? `${route}/${suffix}` : route;
      return `${attr}="${normalizedBaseUrl}/${normalizedPath}"`;
    }
  );
}

// Fix asset paths to point to server
widgetHtml = rewriteAssetUrls(widgetHtml, 'widgets');

function readConsentTemplate() {
  return readFileWithFallback(consentHtmlPrimaryPath, consentHtmlFallbackPath);
}

function renderAuthorizationPage(context: AuthorizationPageContext) {
  const template = readConsentTemplate();
  const contextJson = serializeAuthorizationContext(context);
  const htmlWithContext = template.replace('__OAUTH_CONTEXT__', contextJson);
  return rewriteAssetUrls(htmlWithContext, 'oauth-assets');
}

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

// Universal intent extraction tool with multi-intent support
server.registerTool("extract_intent", {
  title: "Analyze Conversation Intent",
  description: "Extracts and structures the user's goals, needs, or objectives from any conversation to help understand what they're trying to accomplish.",
  inputSchema: {
    fullInputText: z.string().describe("Full input text"),
    rawText: z.string().optional().describe("Raw text content from uploaded file"),
    conversationHistory: z.string().optional().describe("Raw conversation history as text"),
    userMemory: z.string().optional().describe("Raw user memory/context as text"),
  },
  annotations: {
    readOnlyHint: true
  }
}, async (input, { _meta }) => {
  console.log(input);

  // Log raw text from file if present
  if (input.rawText) {
    console.log('\n--- FILE CONTENT ---');
    console.log('Raw text length:', input.rawText.length, 'characters');
    console.log('Raw text preview:', input.rawText.substring(0, 50000));
  }

  // Log conversation history if present
  if (input.conversationHistory) {
    console.log('\n--- CONVERSATION HISTORY ---');
    console.log('History length:', input.conversationHistory.length, 'characters');
    console.log('History preview:', input.conversationHistory.substring(0, 50000));
  }

  // Log user memory if present
  if (input.userMemory) {
    console.log('\n--- USER MEMORY ---');
    console.log('Memory length:', input.userMemory.length, 'characters');
    console.log('Memory preview:', input.userMemory.substring(0, 50000));
  }

  return {
    content: [{
      type: "text",
      text: "ok",
    }],
  };
});

const app = express();
app.set("trust proxy", true);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
  origin: '*',
  exposedHeaders: ['Mcp-Session-Id'],
  allowedHeaders: ['Content-Type', 'mcp-session-id'],
}));

app.use('/widgets', express.static(join(__dirname, '../widgets/dist')));
app.use('/oauth-assets', express.static(join(__dirname, '../widgets/dist'), {
  cacheControl: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

function asString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function asScope(
  value: unknown
): string | string[] | undefined {
  if (typeof value === "string" || typeof value === "undefined") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.filter((entry) => typeof entry === "string") as string[];
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function respondOAuthError(res: Response, error: unknown): void {
  const oauthError = (error as any)?.oauthError ?? "server_error";
  const description =
    (error as any)?.errorDescription ??
    (error instanceof Error ? error.message : "OAuth error");
  const status = oauthError === "server_error" ? 500 : 400;
  if (status === 500) {
    console.error("OAuth error:", error);
  }
  res
    .status(status)
    .json({ error: oauthError, error_description: description });
}

function getRequestOrigin(req: Request) {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost ?? req.header("host");
  if (!host) {
    return `${normalizedBaseUrl}`;
  }
  return `${proto}://${host}`;
}

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json(authorizationServerMetadata());
});

app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json(protectedResourceMetadata());
});

function buildMcpManifest(req: Request) {
  const origin = getRequestOrigin(req).replace(/\/$/, '');
  return {
    "@context": "https://agent-mcp.org/manifest-1.0",
    "protocol_version": "0.1",
    "name": "index-mcp-server",
    "version": "1.0.0",
    "description": "Index Network MCP server exposing the echo tool and intent logging over OAuth-protected access.",
    "capabilities": {
      "tools": true,
      "resources": true,
      "notifications": false
    },
    "servers": [
      {
        "type": "mcp",
        "url": `${origin}/mcp`
      }
    ],
    "authentication": {
      "type": "oauth2",
      "authorization_url": `${origin}/oauth/authorize`,
      "token_url": `${origin}/oauth/token`,
      "revocation_url": `${origin}/oauth/revoke`,
      "registration_url": `${origin}/oauth/register`,
      "userinfo_url": `${origin}/oauth/userinfo`,
      "scopes": listSupportedScopes()
    },
    "contact": {
      "name": "Index Network Support",
      "email": "hello@index.network"
    },
    "terms_of_service_url": "https://index.network/legal/terms",
    "privacy_policy_url": "https://index.network/legal/privacy"
  };
}

function sendManifest(req: Request, res: Response) {
  const manifest = buildMcpManifest(req);
  res.type('application/json').send(JSON.stringify(manifest, null, 2));
}

app.get('/.well-known/mcp.json', (req, res) => {
  sendManifest(req, res);
});

app.get('/.well-known/mcp/manifest.json', (req, res) => {
  sendManifest(req, res);
});

app.get('/.well-known/manifest.json', (req, res) => {
  sendManifest(req, res);
});

app.post('/oauth/register', (req, res) => {
  try {
    const registration = registerClient(req.body ?? {});
    res
      .status(201)
      .json(registration);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.get('/oauth/authorize', (req, res) => {
  if (!req.query || Object.keys(req.query).length === 0) {
    res.status(204).end();
    return;
  }

  console.log('[oauth] authorize request', req.query);
  try {
    const origin = getRequestOrigin(req);
    const authorizeUri = new URL('/oauth/authorize', origin).toString();
    const completeUri = new URL('/oauth/authorize/complete', origin).toString();

    const pageContext = prepareAuthorization({
      response_type: asString(req.query.response_type),
      client_id: asString(req.query.client_id),
      redirect_uri: asString(req.query.redirect_uri),
      scope: asScope(req.query.scope),
      state: asString(req.query.state),
      code_challenge: asString(req.query.code_challenge),
      code_challenge_method: asString(req.query.code_challenge_method),
      resource: asString(req.query.resource),
      nonce: asString(req.query.nonce),
      authorizeUri,
      completeUri,
    });
    const html = renderAuthorizationPage(pageContext);
    res.type('html').send(html);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.post('/oauth/authorize/complete', async (req, res) => {
  const { state, privyToken, fallbackToken } = req.body ?? {};
  if (!state || !privyToken) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "state and privyToken are required.",
    });
    return;
  }

  try {
    const result = await completeAuthorization({ state, privyToken, fallbackToken });
    res.json(result);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.post('/oauth/token', (req, res) => {
  try {
    const grantType = req.body?.grant_type;
    let payload: TokenEndpointResponse;

    if (grantType === 'authorization_code') {
      payload = exchangeCodeForTokens({
        code: req.body.code,
        code_verifier: req.body.code_verifier,
        client_id: req.body.client_id,
        redirect_uri: req.body.redirect_uri,
      });
    } else if (grantType === 'refresh_token') {
      payload = refreshAccessToken({
        refresh_token: req.body.refresh_token,
        client_id: req.body.client_id,
        scope: req.body.scope,
      });
    } else {
      throw Object.assign(new Error('Unsupported grant_type'), {
        oauthError: 'unsupported_grant_type',
        errorDescription: 'Only authorization_code and refresh_token grants are supported.',
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.json(payload);
  } catch (error) {
    respondOAuthError(res, error);
  }
});

app.post('/oauth/revoke', (req, res) => {
  revokeToken({
    token: req.body?.token,
    token_type_hint: req.body?.token_type_hint,
  });
  res.status(200).json({ revoked: true });
});

app.get('/oauth/userinfo', authenticatePrivy, (req: AuthenticatedRequest, res) => {
  if (!req.privyClaims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const claims = req.privyClaims;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.json({
    sub: claims.user_id,
    privy_user_id: claims.user_id,
    privy_session_id: claims.session_id,
    iss: claims.issuer,
    aud: req.oauth?.clientId,
    scope: req.oauth?.scope.join(' ') ?? '',
    exp: claims.expiration,
    iat: claims.issued_at,
  });
});

/**
 * Main MCP endpoint for stateless communication
 * Handles tool invocations and returns widget responses
 */
app.post('/mcp', authenticatePrivy, async (req: AuthenticatedRequest, res) => {
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
