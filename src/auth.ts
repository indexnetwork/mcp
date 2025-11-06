import type { NextFunction, Request, Response } from "express";
import type { VerifyAuthTokenResponse } from "./privy";
import { validateAccessToken } from "./oauth";

export interface OAuthSessionContext {
  accessToken: string;
  clientId: string;
  scope: string[];
  resource?: string;
  expiresAt: number;
}

export interface AuthenticatedRequest extends Request {
  /**
   * Claims returned from Privy after verifying the bearer token.
   * Includes identifiers such as userId, sessionId, and token expiration.
   */
  privyClaims?: VerifyAuthTokenResponse;
  /**
   * Context for the validated OAuth session associated with this request.
   */
  oauth?: OAuthSessionContext;
}

const skipAuth = process.env.DANGEROUSLY_OMIT_AUTH === "true";

/**
 * Express middleware that validates access tokens issued by the local OAuth facade.
 * Rejects unauthorized requests and attaches verified Privy claims to the request object.
 */
export async function authenticatePrivy(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (skipAuth) {
    return next();
  }

  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;

  if (!token) {
    res.setHeader(
      "WWW-Authenticate",
      'Bearer realm="index-mcp", error="invalid_token", error_description="Missing bearer token."'
    );
    return res.status(401).json({ error: "Missing bearer token." });
  }

  const validation = validateAccessToken(token);

  if (!validation.valid) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer realm="index-mcp", error="${
        validation.error === "expired" ? "invalid_token" : "invalid_grant"
      }", error_description="${validation.message}"`
    );
    return res.status(401).json({ error: validation.message });
  }

  req.privyClaims = validation.claims;
  req.oauth = {
    accessToken: token,
    clientId: validation.clientId,
    scope: validation.scope,
    resource: validation.resource,
    expiresAt: validation.expiresAt,
  };

  return next();
}

