/**
 * OAuth2 discovery endpoints (/mcp/.well-known/*)
 * These endpoints provide metadata about the authorization server
 */

import { Router } from 'express';
import { importSPKI, exportJWK } from 'jose';
import { config } from '../config.js';

export const wellKnownRouter = Router();

function buildAuthorizationServerMetadata() {
  return {
    issuer: config.jwt.issuer,
    authorization_endpoint: config.oauth.authorizationEndpoint,
    token_endpoint: config.oauth.tokenEndpoint,
    jwks_uri: config.oauth.jwksEndpoint,
    registration_endpoint: config.oauth.registrationEndpoint,
    scopes_supported: config.oauth.scopesSupported,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
  };
}

function buildProtectedResourceMetadata() {
  return {
    resource: config.server.baseUrl,
    authorization_servers: [config.server.baseUrl],
    scopes_supported: config.oauth.scopesSupported,
    resource_documentation: `${config.server.baseUrl}/docs`,
  };
}

function buildOpenIdMetadata() {
  return {
    issuer: config.jwt.issuer,
    authorization_endpoint: config.oauth.authorizationEndpoint,
    token_endpoint: config.oauth.tokenEndpoint,
    jwks_uri: config.oauth.jwksEndpoint,
    registration_endpoint: config.oauth.registrationEndpoint,
    scopes_supported: [...config.oauth.scopesSupported, 'openid', 'email'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
  };
}

/**
 * OAuth Authorization Server Metadata
 * RFC 8414: https://tools.ietf.org/html/rfc8414
 */
wellKnownRouter.get('/oauth-authorization-server', (req, res) => {
  res.json(buildAuthorizationServerMetadata());
});

// Support scoped discovery paths (e.g., /.well-known/oauth-authorization-server/mcp)
wellKnownRouter.get('/oauth-authorization-server/:resource', (req, res) => {
  res.json(buildAuthorizationServerMetadata());
});

/**
 * Protected Resource Metadata
 * Advertises this server as a protected resource requiring OAuth
 */
wellKnownRouter.get('/oauth-protected-resource', (req, res) => {
  res.json(buildProtectedResourceMetadata());
});

wellKnownRouter.get('/oauth-protected-resource/:resource', (req, res) => {
  res.json(buildProtectedResourceMetadata());
});

/**
 * JSON Web Key Set (JWKS)
 * Publishes public keys for JWT signature verification
 */
wellKnownRouter.get('/jwks.json', async (_req, res) => {
  try {
    // Convert PEM public key to JWK format using jose library
    const publicKey = await importSPKI(config.jwt.publicKey, 'RS256');
    const jwk = await exportJWK(publicKey);

    res.json({
      keys: [
        {
          ...jwk,
          use: 'sig',
          alg: 'RS256',
          kid: 'key-1',
        },
      ],
    });
  } catch (error) {
    console.error('Error generating JWKS:', error);
    res.status(500).json({ error: 'Failed to generate JWKS' });
  }
});

/**
 * OpenID Connect Discovery (optional, for future use)
 */
wellKnownRouter.get('/openid-configuration', (req, res) => {
  res.json(buildOpenIdMetadata());
});

wellKnownRouter.get('/openid-configuration/:resource', (req, res) => {
  res.json(buildOpenIdMetadata());
});
