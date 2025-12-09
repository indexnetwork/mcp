/**
 * Dynamic Client Registration (DCR)
 * RFC 7591: https://tools.ietf.org/html/rfc7591
 *
 * Allows ChatGPT to dynamically register as an OAuth client
 */

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getRepositories } from './repositories/index.js';

export async function handleDynamicClientRegistration(req: Request, res: Response) {
  try {
    const {
      redirect_uris,
      client_name,
      client_uri,
      logo_uri,
      tos_uri,
      policy_uri,
      grant_types,
      response_types,
      scope,
    } = req.body;

    // Validate required fields
    if (!redirect_uris || !Array.isArray(redirect_uris) || redirect_uris.length === 0) {
      return res.status(400).json({
        error: 'invalid_redirect_uri',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
    }

    // Validate redirect URIs (must be HTTPS in production)
    for (const uri of redirect_uris) {
      try {
        const url = new URL(uri);
        // In production, enforce HTTPS
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
          return res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: 'redirect_uris must use HTTPS in production',
          });
        }
      } catch (error) {
        return res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: `Invalid URI: ${uri}`,
        });
      }
    }

    // Validate grant types
    const supportedGrantTypes = ['authorization_code', 'refresh_token'];
    const requestedGrantTypes = grant_types || ['authorization_code', 'refresh_token'];

    for (const grantType of requestedGrantTypes) {
      if (!supportedGrantTypes.includes(grantType)) {
        return res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: `Unsupported grant_type: ${grantType}`,
        });
      }
    }

    // Validate response types
    const supportedResponseTypes = ['code'];
    const requestedResponseTypes = response_types || ['code'];

    for (const responseType of requestedResponseTypes) {
      if (!supportedResponseTypes.includes(responseType)) {
        return res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: `Unsupported response_type: ${responseType}`,
        });
      }
    }

    // Register the client via repository
    const repos = getRepositories();
    const clientId = `client_${uuidv4()}`;
    const client = await repos.clients.create({
      id: clientId,
      clientName: client_name,
      redirectUris: redirect_uris,
    });

    // Build response according to RFC 7591
    const response: Record<string, any> = {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      redirect_uris: client.redirectUris,
      grant_types: requestedGrantTypes.filter((grant: string) => supportedGrantTypes.includes(grant)),
      response_types: requestedResponseTypes,
      token_endpoint_auth_method: 'none', // PKCE doesn't require client secret
    };

    // Include optional metadata if provided
    if (client_name) response.client_name = client_name;
    if (client_uri) response.client_uri = client_uri;
    if (logo_uri) response.logo_uri = logo_uri;
    if (tos_uri) response.tos_uri = tos_uri;
    if (policy_uri) response.policy_uri = policy_uri;
    if (scope) response.scope = scope;

    res.status(201).json(response);
  } catch (error) {
    console.error('DCR error:', error);
    res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred during client registration',
    });
  }
}
