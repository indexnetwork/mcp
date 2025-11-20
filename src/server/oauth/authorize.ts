/**
 * OAuth2 Authorization Endpoint
 * Handles authorization requests and consent
 */

import { Router } from 'express';
import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config.js';
import {
  storeAuthorizationCode,
  validateClientAndRedirectUri,
  getRegisteredClient,
} from './storage.js';
import { logAuthEvent } from './logger.js';

// Initialize Privy client for token verification
const privyClient = new PrivyClient(
  config.privy.appId,
  config.privy.appSecret
);

export const authorizeRouter = Router();

/**
 * GET /authorize
 * Initial authorization request - validates parameters and serves UI
 * The actual UI is rendered by the React frontend
 */
authorizeRouter.get('/', (req, res, next) => {
  try {
    const {
      response_type,
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
      resource,
    } = req.query;

    // Validate response_type
    if (response_type !== 'code') {
      return redirectWithError(
        redirect_uri as string,
        'unsupported_response_type',
        'Only code response_type is supported',
        state as string
      );
    }

    // Validate required parameters
    if (!client_id || !redirect_uri || !code_challenge || !code_challenge_method) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameters',
      });
    }

    // Validate PKCE
    if (code_challenge_method !== 'S256') {
      return redirectWithError(
        redirect_uri as string,
        'invalid_request',
        'Only S256 code_challenge_method is supported',
        state as string
      );
    }

    // Get client info for validation logging
    const client = getRegisteredClient(client_id as string);
    const redirectUriAllowed = client ? client.redirectUris.includes(redirect_uri as string) : false;

    // Log the authorization request
    logAuthEvent('authorize_request', {
      client_id,
      redirect_uri,
      has_registered_client: !!client,
      redirect_uri_allowed: redirectUriAllowed,
    });

    // Validate client and redirect URI
    if (!validateClientAndRedirectUri(client_id as string, redirect_uri as string)) {
      logAuthEvent('authorize_invalid_client', {
        client_id,
        redirect_uri,
        reason: !client ? 'unknown_client_id' : 'redirect_uri_not_in_registered_uris',
      });
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Invalid client_id or redirect_uri',
      });
    }

    // This check is redundant after validateClientAndRedirectUri but kept for safety
    if (!client) {
      logAuthEvent('authorize_invalid_client', {
        client_id,
        redirect_uri,
        reason: 'unknown_client_id',
      });
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Client not found',
      });
    }

    // Pass through to React app
    // The React frontend will handle the Privy authentication and consent UI
    next();
  } catch (error) {
    console.error('Authorization endpoint error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred',
    });
  }
});

/**
 * POST /authorize/complete
 * Programmatic endpoint for ChatGPT to complete authorization with Privy token
 * Bypasses browser UI for non-interactive flows
 */
authorizeRouter.post('/complete', async (req, res) => {
  try {
    const {
      state,
      privy_token,
      fallback_token,
    } = req.body;

    // state parameter contains the original authorization request parameters
    // In a production system, you'd store these in the authorization request
    // For now, we'll require all parameters to be passed again
    const {
      client_id,
      redirect_uri,
      scope,
      code_challenge,
      code_challenge_method,
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
      console.log('[authorize/complete] Verifying Privy token');
      privyClaims = await privyClient.verifyAuthToken(privy_token);
      console.log('[authorize/complete] Privy token verified for user', privyClaims.userId);
    } catch (error) {
      // Try fallback token if primary fails
      if (fallback_token) {
        console.warn('[authorize/complete] Primary token failed, trying fallback');
        try {
          privyClaims = await privyClient.verifyAuthToken(fallback_token);
          tokenUsed = fallback_token;
          console.log('[authorize/complete] Fallback token verified for user', privyClaims.userId);
        } catch (fallbackError) {
          console.error('[authorize/complete] Both tokens failed:', error, fallbackError);
          return res.status(401).json({
            error: 'invalid_token',
            error_description: 'Failed to verify Privy token',
          });
        }
      } else {
        console.error('[authorize/complete] Privy token verification failed:', error);
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Failed to verify Privy token',
        });
      }
    }

    // Get client info for validation logging
    const client = getRegisteredClient(client_id);
    const redirectUriAllowed = client ? client.redirectUris.includes(redirect_uri) : false;

    // Log the authorization complete request
    logAuthEvent('authorize_complete_request', {
      client_id,
      redirect_uri,
      has_registered_client: !!client,
      redirect_uri_allowed: redirectUriAllowed,
    });

    // Validate client and redirect URI
    if (!validateClientAndRedirectUri(client_id, redirect_uri)) {
      logAuthEvent('authorize_complete_invalid_client', {
        client_id,
        redirect_uri,
        reason: !client ? 'unknown_client_id' : 'redirect_uri_not_in_registered_uris',
      });
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Invalid client_id or redirect_uri',
      });
    }

    // Validate PKCE
    if (code_challenge_method !== 'S256') {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Only S256 code_challenge_method is supported',
      });
    }

    // Parse and validate scopes
    const requestedScopes = scope ? scope.split(' ') : ['read'];

    // Always include privy:token:exchange scope
    if (!requestedScopes.includes('privy:token:exchange')) {
      requestedScopes.push('privy:token:exchange');
    }

    const validScopes = requestedScopes.filter((s: string) =>
      (config.oauth.scopesSupported as readonly string[]).includes(s)
    );

    // Generate and store authorization code
    const authCode = storeAuthorizationCode({
      clientId: client_id,
      privyUserId: privyClaims.userId,
      privyToken: tokenUsed,
      privyClaims,
      scopes: validScopes,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      redirectUri: redirect_uri,
      expiresAt: Date.now() + 30000, // 30 seconds
    });

    // Build redirect URL
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    console.log('[authorize/complete] Authorization complete, redirecting to', redirect_uri);

    // Return the redirect URL
    res.json({
      code: authCode,
      redirect_uri: redirectUrl.toString(),
      state: state || undefined,
    });
  } catch (error) {
    console.error('Authorization complete error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred',
    });
  }
});

/**
 * POST /authorize
 * Receives consent from the frontend after Privy authentication
 */
authorizeRouter.post('/', async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      scope,
      state,
      code_challenge,
      code_challenge_method,
      privy_user_id,
      privy_token,
      user_consent,
    } = req.body;

    // Validate consent
    if (!user_consent) {
      return redirectWithError(
        redirect_uri,
        'access_denied',
        'User denied the authorization request',
        state
      );
    }

    // Validate Privy user ID and token
    if (!privy_user_id) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing privy_user_id',
      });
    }

    if (!privy_token) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing privy_token',
      });
    }

    // Verify Privy token using Privy SDK
    let privyClaims;
    try {
      console.log('[authorize] Verifying Privy token for user', privy_user_id);
      privyClaims = await privyClient.verifyAuthToken(privy_token);

      // Validate the privy_user_id matches the verified claims
      if (privyClaims.userId !== privy_user_id) {
        console.error('[authorize] User ID mismatch:', privyClaims.userId, 'vs', privy_user_id);
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Privy user ID does not match token claims',
        });
      }

      console.log('[authorize] Privy token verified successfully for', privyClaims.userId);
    } catch (error) {
      console.error('[authorize] Privy token verification failed:', error);
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Failed to verify Privy token',
      });
    }

    // Get client info for validation logging
    const client = getRegisteredClient(client_id);
    const redirectUriAllowed = client ? client.redirectUris.includes(redirect_uri) : false;

    // Log the authorization consent request
    logAuthEvent('authorize_consent_request', {
      client_id,
      redirect_uri,
      has_registered_client: !!client,
      redirect_uri_allowed: redirectUriAllowed,
    });

    // Validate client and redirect URI
    if (!validateClientAndRedirectUri(client_id, redirect_uri)) {
      logAuthEvent('authorize_consent_invalid_client', {
        client_id,
        redirect_uri,
        reason: !client ? 'unknown_client_id' : 'redirect_uri_not_in_registered_uris',
      });
      return res.status(400).json({
        error: 'invalid_client',
        error_description: 'Invalid client_id or redirect_uri',
      });
    }

    // Parse and validate scopes
    const requestedScopes = scope ? scope.split(' ') : ['read'];

    // Always include privy:token:exchange scope for MCP tools to function
    if (!requestedScopes.includes('privy:token:exchange')) {
      requestedScopes.push('privy:token:exchange');
    }

    const validScopes = requestedScopes.filter((s: string) =>
      (config.oauth.scopesSupported as readonly string[]).includes(s)
    );

    if (validScopes.length === 0) {
      return redirectWithError(
        redirect_uri,
        'invalid_scope',
        'No valid scopes requested',
        state
      );
    }

    // Generate and store authorization code (including the Privy token and verified claims)
    const authCode = storeAuthorizationCode({
      clientId: client_id,
      privyUserId: privy_user_id,
      privyToken: privy_token,  // Store the Privy token for later exchange
      privyClaims,  // Store verified claims from Privy
      scopes: validScopes,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method,
      redirectUri: redirect_uri,
      expiresAt: Date.now() + 30000, // 30 seconds
    });

    // Build redirect URL with authorization code
    const redirectUrl = new URL(redirect_uri);
    redirectUrl.searchParams.set('code', authCode);
    if (state) {
      redirectUrl.searchParams.set('state', state);
    }

    // Return the code to the frontend for redirect
    res.json({
      redirect_uri: redirectUrl.toString(),
      code: authCode,
      state: state || undefined,
    });
  } catch (error) {
    console.error('Authorization consent error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred',
    });
  }
});

/**
 * Helper function to redirect with error
 */
function redirectWithError(
  redirectUri: string,
  error: string,
  errorDescription: string,
  state?: string
): void {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', errorDescription);
  if (state) {
    url.searchParams.set('state', state);
  }
  // In Express, we can't redirect from this helper, so we'll return the URL
  throw new Error(`Redirect to: ${url.toString()}`);
}
