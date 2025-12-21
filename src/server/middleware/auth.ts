/**
 * JWT Token Validation Middleware
 * Validates OAuth2 access tokens on MCP requests
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      auth?: {
        token: string;
        decoded: jwt.JwtPayload;
        userId: string;
        scopes: string[];
      };
    }
  }
}

/**
 * Middleware to validate JWT access tokens
 */
export function validateToken(requiredScopes: string[] = []) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendAuthChallenge(res, requiredScopes);
      }

      const token = authHeader.substring(7); // Remove "Bearer " prefix

      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.publicKey, {
        algorithms: [config.jwt.algorithm],
        issuer: config.jwt.issuer,
        audience: config.server.baseUrl,
      }) as jwt.JwtPayload;

      // Extract scopes
      const tokenScopes = decoded.scope ? decoded.scope.split(' ') : [];

      // Check required scopes
      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every(scope =>
          tokenScopes.includes(scope)
        );

        if (!hasAllScopes) {
          return sendInsufficientScopeError(res, requiredScopes);
        }
      }

      // Attach auth info to request
      req.auth = {
        token,
        decoded,
        userId: decoded.sub as string, // Privy DID
        scopes: tokenScopes,
      };

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return sendTokenExpiredError(res, requiredScopes);
      } else if (error instanceof jwt.JsonWebTokenError) {
        return sendInvalidTokenError(res, requiredScopes);
      } else {
        console.error('Token validation error:', error);
        return res.status(500).json({
          error: 'server_error',
          error_description: 'An error occurred while validating the token',
        });
      }
    }
  };
}

/**
 * Send WWW-Authenticate challenge for missing/invalid token
 */
function sendAuthChallenge(res: Response, requiredScopes: string[]) {
  const scopeString = requiredScopes.length > 0 ? requiredScopes.join(' ') : undefined;
  const challenge = buildWWWAuthenticateHeader('Authentication required', scopeString);

  res.status(401)
    .set('WWW-Authenticate', challenge)
    .json({
      error: 'unauthorized',
      error_description: 'Authentication required',
      _meta: {
        'mcp/www_authenticate': challenge,
      },
    });
}

/**
 * Send error for expired token
 */
function sendTokenExpiredError(res: Response, requiredScopes: string[]) {
  const scopeString = requiredScopes.length > 0 ? requiredScopes.join(' ') : undefined;
  const challenge = buildWWWAuthenticateHeader('Token expired', scopeString, 'invalid_token');

  res.status(401)
    .set('WWW-Authenticate', challenge)
    .json({
      error: 'invalid_token',
      error_description: 'Token has expired',
      _meta: {
        'mcp/www_authenticate': challenge,
      },
    });
}

/**
 * Send error for invalid token
 */
function sendInvalidTokenError(res: Response, requiredScopes: string[]) {
  const scopeString = requiredScopes.length > 0 ? requiredScopes.join(' ') : undefined;
  const challenge = buildWWWAuthenticateHeader('Invalid token', scopeString, 'invalid_token');

  res.status(401)
    .set('WWW-Authenticate', challenge)
    .json({
      error: 'invalid_token',
      error_description: 'Token is invalid',
      _meta: {
        'mcp/www_authenticate': challenge,
      },
    });
}

/**
 * Send error for insufficient scopes
 */
function sendInsufficientScopeError(res: Response, requiredScopes: string[]) {
  const scopeString = requiredScopes.join(' ');
  const challenge = buildWWWAuthenticateHeader(
    'Insufficient scopes',
    scopeString,
    'insufficient_scope'
  );

  res.status(403)
    .set('WWW-Authenticate', challenge)
    .json({
      error: 'insufficient_scope',
      error_description: `Required scopes: ${scopeString}`,
      _meta: {
        'mcp/www_authenticate': challenge,
      },
    });
}

/**
 * Build WWW-Authenticate header value
 */
function buildWWWAuthenticateHeader(
  description: string,
  scope?: string,
  error?: string
): string {
  const parts = [
    'Bearer',
    `resource_metadata="${config.server.baseUrl}/mcp/.well-known/oauth-protected-resource"`,
  ];

  if (error) {
    parts.push(`error="${error}"`);
  }

  if (description) {
    parts.push(`error_description="${description}"`);
  }

  if (scope) {
    parts.push(`scope="${scope}"`);
  }

  return parts.join(', ');
}
