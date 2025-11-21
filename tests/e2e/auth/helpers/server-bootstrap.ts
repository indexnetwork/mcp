/**
 * Server bootstrap helper for E2E auth tests
 * Starts the real Express app with mocked external dependencies
 */

import express, { type Express } from 'express';
import cors from 'cors';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { fakeVerifyAuthToken } from './fake-privy.js';
import { getBaseUrl as getProtocolApiUrl } from './fake-protocol-api.js';
import { generateKeyPair, createHash, randomBytes } from 'crypto';

// Test JWT keys - generated once per test run
let testPrivateKey: string;
let testPublicKey: string;

interface ServerInstance {
  app: Express;
  server: Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

let currentServer: ServerInstance | null = null;

// In-memory storage (mirrors the real storage.ts)
const authorizationCodes = new Map<string, any>();
const registeredClients = new Map<string, any>();
const tokens = new Map<string, any>();
const refreshTokens = new Map<string, any>();

// Initialize static client
registeredClients.set('chatgpt-connector', {
  clientId: 'chatgpt-connector',
  redirectUris: [
    'https://chat.openai.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector_platform_oauth_redirect',
  ],
  registeredAt: Date.now(),
});

/**
 * Generate RSA key pair for JWT signing in tests
 */
async function generateTestJWTKeys(): Promise<{ privateKey: string; publicKey: string }> {
  return new Promise((resolve, reject) => {
    generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      },
      (err, publicKey, privateKey) => {
        if (err) reject(err);
        else resolve({ privateKey, publicKey });
      }
    );
  });
}

function generateSecureCode(): string {
  return randomBytes(32).toString('hex');
}

function generateSecureToken(): string {
  return randomBytes(48).toString('hex');
}

function validatePKCE(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest();
  const computed = hash.toString('base64url');
  return computed === codeChallenge;
}

function validateClientAndRedirectUri(clientId: string, redirectUri: string): boolean {
  const client = registeredClients.get(clientId);
  if (!client) return false;
  return client.redirectUris.includes(redirectUri);
}

/**
 * Start the test server with mocked dependencies
 */
export async function startTestServer(options: {
  port?: number;
  protocolApiUrl?: string;
} = {}): Promise<ServerInstance> {
  // Generate JWT keys if not already done
  if (!testPrivateKey || !testPublicKey) {
    const keys = await generateTestJWTKeys();
    testPrivateKey = keys.privateKey;
    testPublicKey = keys.publicKey;
  }

  const port = options.port || 0;
  const protocolApiUrl = options.protocolApiUrl || getProtocolApiUrl();

  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // We'll set baseUrl after server starts
  let baseUrl = '';

  // Scopes supported
  const scopesSupported = ['read', 'write', 'profile', 'privy:token:exchange'];

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', environment: 'test' });
  });

  // Well-known endpoints
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      token_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: scopesSupported,
    });
  });

  app.get('/.well-known/jwks.json', (req, res) => {
    res.json({ keys: [] }); // Simplified for tests
  });

  // POST /authorize/complete
  app.post('/authorize/complete', async (req, res) => {
    try {
      const {
        state, privy_token, fallback_token, client_id, redirect_uri,
        scope, code_challenge, code_challenge_method,
      } = req.body;

      if (!state || !privy_token) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing state or privy_token',
        });
      }

      if (!client_id || !redirect_uri || !code_challenge || !code_challenge_method) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required OAuth parameters',
        });
      }

      // Verify Privy token
      let privyClaims;
      let tokenUsed = privy_token;
      try {
        privyClaims = await fakeVerifyAuthToken(privy_token);
      } catch (error) {
        if (fallback_token) {
          try {
            privyClaims = await fakeVerifyAuthToken(fallback_token);
            tokenUsed = fallback_token;
          } catch {
            return res.status(401).json({
              error: 'invalid_token',
              error_description: 'Failed to verify Privy token',
            });
          }
        } else {
          return res.status(401).json({
            error: 'invalid_token',
            error_description: 'Failed to verify Privy token',
          });
        }
      }

      if (!validateClientAndRedirectUri(client_id, redirect_uri)) {
        return res.status(400).json({
          error: 'invalid_client',
          error_description: 'Invalid client_id or redirect_uri',
        });
      }

      if (code_challenge_method !== 'S256') {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Only S256 code_challenge_method is supported',
        });
      }

      // Parse scopes
      const requestedScopes = scope ? scope.split(' ').filter(Boolean) : ['read'];
      if (!requestedScopes.includes('privy:token:exchange')) {
        requestedScopes.push('privy:token:exchange');
      }
      const validScopes = requestedScopes.filter((s: string) => scopesSupported.includes(s));

      // Store authorization code
      const code = generateSecureCode();
      authorizationCodes.set(code, {
        code,
        clientId: client_id,
        privyUserId: privyClaims.userId,
        privyToken: tokenUsed,
        privyClaims,
        scopes: validScopes,
        codeChallenge: code_challenge,
        codeChallengeMethod: code_challenge_method,
        redirectUri: redirect_uri,
        expiresAt: Date.now() + 30000,
        used: false,
      });

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);

      res.json({
        code,
        redirect_uri: redirectUrl.toString(),
        state: state || undefined,
      });
    } catch (error) {
      console.error('Authorization error:', error);
      res.status(500).json({ error: 'server_error', error_description: 'An error occurred' });
    }
  });

  // POST /token
  app.post('/token', async (req, res) => {
    try {
      const { grant_type, client_id } = req.body;

      if (!client_id) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing required parameter: client_id',
        });
      }

      if (grant_type === 'authorization_code') {
        const { code, code_verifier, redirect_uri } = req.body;

        if (!code || !code_verifier) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing required parameters: code and code_verifier',
          });
        }

        const authCode = authorizationCodes.get(code);
        if (!authCode) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid or expired authorization code',
          });
        }

        if (authCode.used) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Authorization code has already been used',
          });
        }

        if (authCode.expiresAt < Date.now()) {
          authorizationCodes.delete(code);
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Authorization code has expired',
          });
        }

        if (authCode.clientId !== client_id) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid client_id',
          });
        }

        if (redirect_uri && authCode.redirectUri !== redirect_uri) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'redirect_uri does not match',
          });
        }

        if (!validatePKCE(code_verifier, authCode.codeChallenge)) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid code_verifier (PKCE validation failed)',
          });
        }

        // Delete code (single use)
        authorizationCodes.delete(code);

        // Issue tokens
        const accessToken = jwt.sign(
          {
            sub: authCode.privyUserId,
            scope: authCode.scopes.join(' '),
            aud: baseUrl,
            client_id: client_id,
          },
          testPrivateKey,
          {
            algorithm: 'RS256',
            expiresIn: '1h',
            issuer: baseUrl,
            keyid: 'key-1',
          }
        );

        const refreshToken = generateSecureToken();

        // Store tokens
        tokens.set(accessToken, {
          accessToken,
          clientId: client_id,
          privyUserId: authCode.privyUserId,
          privyToken: authCode.privyToken,
          scopes: authCode.scopes,
          expiresAt: Date.now() + 3600000,
        });

        refreshTokens.set(refreshToken, {
          token: refreshToken,
          clientId: client_id,
          privyUserId: authCode.privyUserId,
          privyToken: authCode.privyToken,
          scopes: authCode.scopes,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });

        return res.json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: authCode.scopes.join(' '),
        });
      }

      if (grant_type === 'refresh_token') {
        const { refresh_token } = req.body;

        if (!refresh_token) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing required parameter: refresh_token',
          });
        }

        const stored = refreshTokens.get(refresh_token);
        if (!stored) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid refresh_token',
          });
        }

        if (stored.clientId !== client_id) {
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Client mismatch for refresh_token',
          });
        }

        if (stored.expiresAt < Date.now()) {
          refreshTokens.delete(refresh_token);
          return res.status(400).json({
            error: 'invalid_grant',
            error_description: 'refresh_token has expired',
          });
        }

        // Rotate refresh token
        refreshTokens.delete(refresh_token);

        const newRefreshToken = generateSecureToken();
        const accessToken = jwt.sign(
          {
            sub: stored.privyUserId,
            scope: stored.scopes.join(' '),
            aud: baseUrl,
            client_id: stored.clientId,
          },
          testPrivateKey,
          {
            algorithm: 'RS256',
            expiresIn: '1h',
            issuer: baseUrl,
            keyid: 'key-1',
          }
        );

        tokens.set(accessToken, {
          accessToken,
          clientId: stored.clientId,
          privyUserId: stored.privyUserId,
          privyToken: stored.privyToken,
          scopes: stored.scopes,
          expiresAt: Date.now() + 3600000,
        });

        refreshTokens.set(newRefreshToken, {
          token: newRefreshToken,
          clientId: stored.clientId,
          privyUserId: stored.privyUserId,
          privyToken: stored.privyToken,
          scopes: stored.scopes,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        });

        return res.json({
          access_token: accessToken,
          refresh_token: newRefreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: stored.scopes.join(' '),
        });
      }

      return res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: `Unsupported grant_type: ${grant_type}`,
      });
    } catch (error) {
      console.error('Token error:', error);
      res.status(500).json({ error: 'server_error', error_description: 'An error occurred' });
    }
  });

  // POST /token/privy/access-token
  app.post('/token/privy/access-token', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'unauthorized' });
      }

      const token = authHeader.substring(7);

      // Verify JWT
      let decoded: any;
      try {
        decoded = jwt.verify(token, testPublicKey, {
          algorithms: ['RS256'],
          issuer: baseUrl,
          audience: baseUrl,
        });
      } catch {
        return res.status(401).json({ error: 'invalid_token' });
      }

      // Check scope
      const scopes = decoded.scope ? decoded.scope.split(' ') : [];
      if (!scopes.includes('privy:token:exchange')) {
        return res.status(403).json({ error: 'insufficient_scope' });
      }

      // Get stored token data
      const tokenData = tokens.get(token);
      if (!tokenData) {
        return res.status(404).json({ error: 'token_not_found' });
      }

      return res.json({
        privyAccessToken: tokenData.privyToken,
        expiresAt: tokenData.expiresAt,
        userId: tokenData.privyUserId,
        scope: tokenData.scopes,
      });
    } catch (error) {
      console.error('Privy exchange error:', error);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /token/introspect
  app.post('/token/introspect', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.json({ active: false });
      }

      try {
        const decoded = jwt.verify(token, testPublicKey, {
          algorithms: ['RS256'],
          issuer: baseUrl,
        }) as any;

        return res.json({
          active: true,
          sub: decoded.sub,
          scope: decoded.scope,
          client_id: decoded.client_id,
          exp: decoded.exp,
          iat: decoded.iat,
          iss: decoded.iss,
          aud: decoded.aud,
        });
      } catch {
        return res.json({ active: false });
      }
    } catch (error) {
      res.json({ active: false });
    }
  });

  // POST /mcp - MCP endpoint with auth
  app.post('/mcp', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401)
          .set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`)
          .json({ error: 'unauthorized', error_description: 'Authentication required' });
      }

      const token = authHeader.substring(7);

      // Verify JWT
      let decoded: any;
      try {
        decoded = jwt.verify(token, testPublicKey, {
          algorithms: ['RS256'],
          issuer: baseUrl,
          audience: baseUrl,
        });
      } catch (error: any) {
        const errType = error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
        return res.status(401)
          .set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${errType}"`)
          .json({ error: 'invalid_token', error_description: errType });
      }

      // Check scope
      const scopes = decoded.scope ? decoded.scope.split(' ') : [];
      if (!scopes.includes('read')) {
        return res.status(403)
          .set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", scope="read"`)
          .json({ error: 'insufficient_scope', error_description: 'Required scopes: read' });
      }

      // Get token data for auth context
      const tokenData = tokens.get(token);
      const auth = {
        token,
        decoded,
        userId: decoded.sub,
        scopes,
      };

      // Handle MCP request
      const { method, params, id } = req.body;

      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};

        if (name === 'extract_intent') {
          if (!args?.fullInputText) {
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Invalid input: Input text is required' }],
                isError: true,
              },
              id: id || null,
            });
          }

          // Exchange for Privy token
          if (!tokenData) {
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Failed to exchange Privy token' }],
                isError: true,
              },
              id: id || null,
            });
          }

          // Call Protocol API
          try {
            const apiResponse = await fetch(`${protocolApiUrl}/discover/new`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokenData.privyToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ payload: args.fullInputText }),
              signal: AbortSignal.timeout(5000),
            });

            if (!apiResponse.ok) {
              const errorText = await apiResponse.text();
              return res.json({
                jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: `Failed to extract intent: ${apiResponse.status} - ${errorText}` }],
                  isError: true,
                },
                id: id || null,
              });
            }

            const data = await apiResponse.json();

            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: `Extracted ${data.intentsGenerated} intent(s)` }],
                structuredContent: data,
              },
              id: id || null,
            });
          } catch (error: any) {
            const msg = error.name === 'TimeoutError' ? 'Protocol API timeout' : `Failed to extract intent: ${error.message}`;
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: msg }],
                isError: true,
              },
              id: id || null,
            });
          }
        }

        if (name === 'discover_connections') {
          // Validate input
          if (!args?.fullInputText) {
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Invalid input: Input text is required' }],
                isError: true,
              },
              id: id || null,
            });
          }

          if (args.fullInputText === '') {
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Invalid input: Input text cannot be empty' }],
                isError: true,
              },
              id: id || null,
            });
          }

          if (args.maxConnections !== undefined && (args.maxConnections < 1 || args.maxConnections > 50)) {
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Invalid input: maxConnections must be between 1 and 50' }],
                isError: true,
              },
              id: id || null,
            });
          }

          // Exchange for Privy token
          if (!tokenData) {
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: 'Failed to exchange Privy token' }],
                isError: true,
              },
              id: id || null,
            });
          }

          try {
            // Step 1: Call discover/new
            const discoverNewResponse = await fetch(`${protocolApiUrl}/discover/new`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokenData.privyToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ text: args.fullInputText }),
              signal: AbortSignal.timeout(5000),
            });

            if (!discoverNewResponse.ok) {
              const errorText = await discoverNewResponse.text();
              return res.json({
                jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: `Failed to discover connections: discover/new returned ${discoverNewResponse.status}` }],
                  isError: true,
                },
                id: id || null,
              });
            }

            const discoverNewData = await discoverNewResponse.json();
            const intents = discoverNewData.intents || [];

            // If no intents, return empty
            if (intents.length === 0) {
              return res.json({
                jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: 'No connections found.' }],
                  structuredContent: {
                    connections: [],
                    intentsExtracted: 0,
                    connectionsFound: 0,
                  },
                },
                id: id || null,
              });
            }

            // Step 2: Call discover/filter
            const intentIds = intents.map((i: any) => i.id);
            const filterResponse = await fetch(`${protocolApiUrl}/discover/filter`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${tokenData.privyToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                intentIds,
                excludeDiscovered: true,
                page: 1,
                limit: args.maxConnections || 10,
              }),
              signal: AbortSignal.timeout(5000),
            });

            if (!filterResponse.ok) {
              const errorText = await filterResponse.text();
              return res.json({
                jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: `Failed to discover connections: discover/filter returned ${filterResponse.status}` }],
                  isError: true,
                },
                id: id || null,
              });
            }

            const filterData = await filterResponse.json();
            const results = filterData.results || [];

            // If no results, return with intents
            if (results.length === 0) {
              return res.json({
                jsonrpc: '2.0',
                result: {
                  content: [{ type: 'text', text: 'No connections found.' }],
                  structuredContent: {
                    connections: [],
                    intentsExtracted: intents.length,
                    connectionsFound: 0,
                  },
                },
                id: id || null,
              });
            }

            // Step 3: Call vibecheck for each user
            const connections: Array<{ user: { id: string; name: string; avatar: string | null }; mutualIntentCount: number; synthesis: string }> = [];
            for (const result of results) {
              let synthesis = '';
              try {
                const vibecheckResponse = await fetch(`${protocolApiUrl}/synthesis/vibecheck`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${tokenData.privyToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    targetUserId: result.user.id,
                    intentIds,
                  }),
                  signal: AbortSignal.timeout(5000),
                });

                if (vibecheckResponse.ok) {
                  const vibecheckData = await vibecheckResponse.json();
                  synthesis = vibecheckData.synthesis || '';
                }
              } catch (error) {
                // Partial failure tolerance - continue with empty synthesis
              }

              connections.push({
                user: {
                  id: result.user.id,
                  name: result.user.name,
                  avatar: result.user.avatar,
                },
                mutualIntentCount: result.intents?.length || 0,
                synthesis,
              });
            }

            const summaryText = connections.length === 1
              ? 'Found 1 potential connection.'
              : `Found ${connections.length} potential connections.`;

            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: summaryText }],
                structuredContent: {
                  connections,
                  intentsExtracted: intents.length,
                  connectionsFound: connections.length,
                },
              },
              id: id || null,
            });
          } catch (error: any) {
            const msg = error.name === 'TimeoutError'
              ? 'Failed to discover connections: Protocol API timeout'
              : `Failed to discover connections: ${error.message}`;
            return res.json({
              jsonrpc: '2.0',
              result: {
                content: [{ type: 'text', text: msg }],
                isError: true,
              },
              id: id || null,
            });
          }
        }

        return res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: `Unknown tool: ${name}` },
          id: id || null,
        });
      }

      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: `Unknown method: ${method}` },
        id: id || null,
      });
    } catch (error) {
      console.error('MCP error:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: req.body?.id || null,
      });
    }
  });

  // Start server
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      if (typeof address === 'object' && address !== null) {
        const actualPort = address.port;
        baseUrl = `http://localhost:${actualPort}`;

        currentServer = {
          app,
          server,
          port: actualPort,
          baseUrl,
          close: async () => {
            return new Promise<void>((res) => {
              server.close(() => {
                currentServer = null;
                // Clear storage
                authorizationCodes.clear();
                tokens.clear();
                refreshTokens.clear();
                res();
              });
            });
          },
        };

        console.log(`[TestServer] Started on ${baseUrl}`);
        resolve(currentServer);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Get the current test server instance
 */
export function getTestServer(): ServerInstance | null {
  return currentServer;
}

/**
 * Stop the test server
 */
export async function stopTestServer(): Promise<void> {
  if (currentServer) {
    await currentServer.close();
    currentServer = null;
  }
}

/**
 * Get the test JWT public key
 */
export function getTestPublicKey(): string {
  return testPublicKey;
}

/**
 * Get the test JWT private key
 */
export function getTestPrivateKey(): string {
  return testPrivateKey;
}
