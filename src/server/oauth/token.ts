/**
 * OAuth2 Token Endpoint
 * Exchanges authorization codes for access tokens
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { validatePKCE } from './storage.js';
import { getRepositories } from './repositories/index.js';
import { validateToken } from '../middleware/auth.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Generate secure random token
function generateSecureToken(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export const tokenRouter = Router();

tokenRouter.post('/', async (req, res) => {
  try {
    const {
      grant_type,
      client_id,
    } = req.body;

    if (!client_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter: client_id',
      });
    }

    if (grant_type === 'authorization_code') {
      return handleAuthorizationCodeGrant(req, res);
    }

    if (grant_type === 'refresh_token') {
      return handleRefreshTokenGrant(req, res);
    }

    // Unsupported grant type
    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `Unsupported grant_type: ${grant_type}`,
    });
  } catch (error) {
    console.error('Token endpoint error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred while generating the access token',
    });
  }
});

async function handleAuthorizationCodeGrant(req: Request, res: Response) {
  const {
    code,
    code_verifier,
    client_id,
    redirect_uri,
    resource,
  } = req.body;

  if (!code || !code_verifier) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameters: code and code_verifier',
    });
  }

  const repos = getRepositories();

  // Retrieve authorization code from repository
  const authCode = await repos.authorizationCodes.findByCode(code);
  if (!authCode) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid or expired authorization code',
    });
  }

  // Check if code has already been used
  if (authCode.used) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has already been used',
    });
  }

  // Check if code has expired
  if (authCode.expiresAt < new Date()) {
    await repos.authorizationCodes.delete(code);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Authorization code has expired',
    });
  }

  // Validate client_id
  if (authCode.clientId !== client_id) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid client_id',
    });
  }

  // Validate redirect_uri if provided
  if (redirect_uri && authCode.redirectUri !== redirect_uri) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'redirect_uri does not match',
    });
  }

  // Validate PKCE code_verifier
  if (!validatePKCE(code_verifier, authCode.codeChallenge)) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid code_verifier (PKCE validation failed)',
    });
  }

  // Delete the authorization code (single use only)
  await repos.authorizationCodes.delete(code);

  const audience = resource || config.server.baseUrl;

  // Generate unique IDs for this issuance
  const accessJti = uuidv4();
  const refreshTokenValue = generateSecureToken();

  const { accessToken, expiresIn } = issueAccessToken({
    jti: accessJti,
    privyUserId: authCode.privyUserId,
    scopes: authCode.scopes,
    clientId: client_id,
    audience,
  });

  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  // Store access token session for /mcp/token/privy/access-token lookups
  await repos.accessTokenSessions.create({
    jti: accessJti,
    clientId: client_id,
    privyUserId: authCode.privyUserId,
    privyAccessToken: authCode.privyToken,
    scopes: authCode.scopes,
    expiresAt: accessExpiresAt,
  });

  // Store refresh token
  await repos.refreshTokens.create({
    token: refreshTokenValue,
    clientId: client_id,
    privyUserId: authCode.privyUserId,
    privyAccessToken: authCode.privyToken,
    scopes: authCode.scopes,
    expiresAt: refreshExpiresAt,
  });

  return res.json({
    access_token: accessToken,
    refresh_token: refreshTokenValue,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: authCode.scopes.join(' '),
  });
}

async function handleRefreshTokenGrant(req: Request, res: Response) {
  const { refresh_token, client_id, resource } = req.body;

  if (!refresh_token) {
    return res.status(400).json({
      error: 'invalid_request',
      error_description: 'Missing required parameter: refresh_token',
    });
  }

  const repos = getRepositories();

  // Find the refresh token in the repository
  const storedRefreshToken = await repos.refreshTokens.findByToken(refresh_token);
  if (!storedRefreshToken) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Invalid refresh_token',
    });
  }

  // Check client_id matches
  if (storedRefreshToken.clientId !== client_id) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Client mismatch for refresh_token',
    });
  }

  // Check if revoked
  if (storedRefreshToken.revokedAt !== null) {
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'refresh_token has been revoked',
    });
  }

  // Check if expired
  if (storedRefreshToken.expiresAt < new Date()) {
    // Clean up the expired token
    await repos.refreshTokens.revokeByToken(refresh_token);
    return res.status(400).json({
      error: 'invalid_grant',
      error_description: 'refresh_token has expired',
    });
  }

  // Rotate refresh token: delete old and create new
  // Both in-memory and postgres repos have deleteByToken method
  const refreshRepo = repos.refreshTokens as any;
  if (typeof refreshRepo.deleteByToken === 'function') {
    await refreshRepo.deleteByToken(refresh_token);
  } else {
    await repos.refreshTokens.revokeByToken(refresh_token);
  }

  const newRefreshTokenValue = generateSecureToken();
  const now = new Date();
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  await repos.refreshTokens.create({
    token: newRefreshTokenValue,
    clientId: storedRefreshToken.clientId,
    privyUserId: storedRefreshToken.privyUserId,
    privyAccessToken: storedRefreshToken.privyAccessToken,
    scopes: storedRefreshToken.scopes,
    expiresAt: refreshExpiresAt,
  });

  const audience = resource || config.server.baseUrl;
  const accessJti = uuidv4();

  const { accessToken, expiresIn } = issueAccessToken({
    jti: accessJti,
    privyUserId: storedRefreshToken.privyUserId,
    scopes: storedRefreshToken.scopes,
    clientId: storedRefreshToken.clientId,
    audience,
  });

  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);

  // Store new access token session
  await repos.accessTokenSessions.create({
    jti: accessJti,
    clientId: storedRefreshToken.clientId,
    privyUserId: storedRefreshToken.privyUserId,
    privyAccessToken: storedRefreshToken.privyAccessToken,
    scopes: storedRefreshToken.scopes,
    expiresAt: accessExpiresAt,
  });

  return res.json({
    access_token: accessToken,
    refresh_token: newRefreshTokenValue,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: storedRefreshToken.scopes.join(' '),
  });
}

function issueAccessToken({
  jti,
  privyUserId,
  scopes,
  clientId,
  audience,
}: {
  jti: string;
  privyUserId: string;
  scopes: string[];
  clientId: string;
  audience: string;
}) {
  const accessToken = jwt.sign(
    {
      jti, // Add JWT ID for session lookup
      sub: privyUserId,
      scope: scopes.join(' '),
      aud: audience,
      client_id: clientId,
    },
    config.jwt.privateKey,
    {
      algorithm: config.jwt.algorithm,
      expiresIn: config.jwt.expiresIn,
      issuer: config.jwt.issuer,
      keyid: 'key-1',
    }
  );

  const expiresInSeconds =
    typeof config.jwt.expiresIn === 'string'
      ? 3600
      : Math.floor((config.jwt.expiresIn as number) / 1000);

  return {
    accessToken,
    expiresIn: expiresInSeconds,
  };
}

/**
 * Token introspection endpoint (optional, for debugging)
 */
tokenRouter.post('/introspect', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        active: false,
      });
    }

    // Verify the token
    const decoded = jwt.verify(token, config.jwt.publicKey, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
    }) as jwt.JwtPayload;

    // Return token info
    res.json({
      active: true,
      sub: decoded.sub,
      scope: decoded.scope,
      client_id: decoded.client_id,
      exp: decoded.exp,
      iat: decoded.iat,
      iss: decoded.iss,
      aud: decoded.aud,
      jti: decoded.jti,
    });
  } catch (error) {
    // Token is invalid or expired
    res.json({
      active: false,
    });
  }
});

/**
 * Privy Token Exchange Endpoint
 *
 * Used by MCP tools to exchange their OAuth access token for the original Privy token
 * that was provided during the authorization flow. This allows tools to call the Protocol API.
 *
 * Now uses the jti claim to look up the session in the repository instead of the full token string.
 */
tokenRouter.post('/privy/access-token', validateToken(['privy:token:exchange']), async (req, res) => {
  try {
    console.log('[privy/access-token] Received exchange request');

    const decoded = req.auth?.decoded;
    const jti = decoded?.jti;

    if (!jti) {
      console.error('[privy/access-token] No jti in token');
      return res.status(400).json({
        error: 'invalid_token',
        error_description: 'Token missing jti claim',
      });
    }

    console.log('[privy/access-token] Looking up session by jti:', jti.slice(0, 8) + '...');

    const repos = getRepositories();
    const session = await repos.accessTokenSessions.findByJti(jti);

    if (!session) {
      console.error('[privy/access-token] Session not found for jti');
      return res.status(404).json({ error: 'token_not_found' });
    }

    // Sanity check: user ID should match
    if (session.privyUserId !== decoded.sub) {
      console.error('[privy/access-token] User ID mismatch');
      return res.status(400).json({
        error: 'invalid_token',
        error_description: 'Token user mismatch',
      });
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      console.error('[privy/access-token] Session expired');
      return res.status(400).json({
        error: 'invalid_token',
        error_description: 'Session expired',
      });
    }

    // Check if privy token has been marked as invalid
    if (session.privyInvalidAt) {
      console.error('[privy/access-token] Privy token marked invalid at:', session.privyInvalidAt);
      const resourceMetadata = `${config.server.baseUrl}/mcp/.well-known/oauth-protected-resource`;
      return res
        .status(401)
        .setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${resourceMetadata}", error="invalid_token", error_description="Your connection has expired. Please sign in again."`,
        )
        .json({ error: 'privy_token_invalid' });
    }

    // Log for debugging (only show preview of token)
    const preview = `${session.privyAccessToken.slice(0, 4)}...${session.privyAccessToken.slice(-4)}`;
    console.log('[privy/access-token] Exchanging token for Privy bearer', preview);

    // Return the Privy token with metadata
    return res.json({
      privyAccessToken: session.privyAccessToken,
      expiresAt: session.expiresAt.getTime(),
      issuedAt: session.createdAt.getTime(),
      userId: session.privyUserId,
      scope: session.scopes,
    });
  } catch (error) {
    console.error('[privy/access-token] Error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to exchange token',
    });
  }
});
