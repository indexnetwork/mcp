import { createHash, randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { URL } from "url";
import { privyAppId, privyClientId, verifyPrivyToken } from "./privy";
import type { VerifyAuthTokenResponse } from "./privy";

type OAuthClient = {
  clientId: string;
  clientName?: string;
  redirectUris: string[];
  scopes: string[];
  clientIdIssuedAt: number;
};

type AuthorizationRequestRecord = {
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  clientSuppliedState?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
  resource?: string;
  nonce?: string;
  createdAt: number;
};

type AuthorizationCodeRecord = {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string[];
  clientSuppliedState?: string;
  resource?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256";
  privyClaims: VerifyAuthTokenResponse;
  privyToken: string;
  createdAt: number;
};

type AccessTokenRecord = {
  token: string;
  clientId: string;
  scope: string[];
  resource?: string;
  privyClaims: VerifyAuthTokenResponse;
  privyToken: string;
  createdAt: number;
  expiresAt: number;
  refreshToken?: string;
};

type RefreshTokenRecord = {
  token: string;
  clientId: string;
  scope: string[];
  resource?: string;
  privyClaims: VerifyAuthTokenResponse;
  privyToken: string;
  createdAt: number;
  expiresAt: number;
  accessToken?: string;
};

export type AuthorizationPageContext = {
  state: string;
  clientId: string;
  clientName?: string;
  scope: string[];
  resource?: string;
  redirectUri: string;
  authorizeUri: string;
  completeUri: string;
  issuer: string;
  privyAppId: string;
  privyClientId?: string;
};

export type TokenEndpointResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type TokenIssuePayload = {
  clientId: string;
  scope: string[];
  resource?: string;
  privyClaims: VerifyAuthTokenResponse;
  privyToken: string;
};

const dataDir = join(process.cwd(), ".data");
const clientsFile = join(dataDir, "oauth-clients.json");

const issuer =
  process.env.OAUTH_ISSUER_URL ||
  process.env.MCP_SERVER_URL ||
  "http://localhost:3002";
const resourceIndicator =
  process.env.OAUTH_RESOURCE_INDICATOR || `${issuer.replace(/\/$/, "")}/mcp`;
const canonicalResourceIndicator = resourceIndicator.replace(/\/$/, "");
const accessTokenTtlSeconds = Number(
  process.env.OAUTH_ACCESS_TOKEN_TTL_SECONDS ?? "3600"
);
const refreshTokenTtlSeconds = Number(
  process.env.OAUTH_REFRESH_TOKEN_TTL_SECONDS ?? "1209600"
);
const authorizationCodeTtlSeconds = Number(
  process.env.OAUTH_CODE_TTL_SECONDS ?? "300"
);
const supportedScopes =
  process.env.OAUTH_SUPPORTED_SCOPES?.split(/\s+/).filter(Boolean) ?? [
    "openid",
    "profile",
    "email",
    "offline_access",
  ];
const defaultScopes =
  process.env.OAUTH_DEFAULT_SCOPES?.split(/\s+/).filter(Boolean) ??
  supportedScopes;

const staticClientIds =
  process.env.OAUTH_ALLOWED_CLIENT_IDS?.split(",").map((id) => id.trim()) ?? [
    "chatgpt-connector",
  ];

const staticRedirectUris =
  process.env.OAUTH_ALLOWED_REDIRECT_URIS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [
    "https://chat.openai.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector_platform_oauth_redirect",
  ];

const clients = new Map<string, OAuthClient>();
const authorizationRequests = new Map<string, AuthorizationRequestRecord>();
const authorizationCodes = new Map<string, AuthorizationCodeRecord>();
const accessTokens = new Map<string, AccessTokenRecord>();
const refreshTokens = new Map<string, RefreshTokenRecord>();

bootstrapClients();

function bootstrapClients() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (existsSync(clientsFile)) {
    try {
      const parsed: OAuthClient[] = JSON.parse(
        readFileSync(clientsFile, "utf-8")
      );
      for (const client of parsed) {
        clients.set(client.clientId, client);
      }
    } catch (error) {
      console.warn("Failed to read persisted OAuth clients:", error);
    }
  }

  for (const id of staticClientIds) {
    if (!clients.has(id)) {
      clients.set(id, {
        clientId: id,
        clientName: "ChatGPT Connector",
        redirectUris: [...staticRedirectUris],
        scopes: [...defaultScopes],
        clientIdIssuedAt: Math.floor(Date.now() / 1000),
      });
    }
  }

  persistClients();
}

function persistClients() {
  try {
    writeFileSync(
      clientsFile,
      JSON.stringify(Array.from(clients.values()), null, 2),
      "utf-8"
    );
  } catch (error) {
    console.warn("Failed to persist OAuth clients:", error);
  }
}

function generateId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function calculateCodeChallenge(codeVerifier: string) {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function cleanupExpiredRecords() {
  const now = Date.now();

  for (const [state, record] of authorizationRequests.entries()) {
    if (record.createdAt + authorizationCodeTtlSeconds * 1000 < now) {
      authorizationRequests.delete(state);
    }
  }

  for (const [code, record] of authorizationCodes.entries()) {
    if (record.createdAt + authorizationCodeTtlSeconds * 1000 < now) {
      authorizationCodes.delete(code);
    }
  }

  for (const [token, record] of accessTokens.entries()) {
    if (record.expiresAt <= now) {
      accessTokens.delete(token);
    }
  }

  for (const [token, record] of refreshTokens.entries()) {
    if (record.expiresAt <= now) {
      refreshTokens.delete(token);
    }
  }
}

function normalizeScope(scope?: string | string[]) {
  if (!scope) return [...defaultScopes];
  const scopes = Array.isArray(scope)
    ? scope.join(" ").split(/\s+/)
    : scope.split(/\s+/);
  const filtered = scopes.filter(Boolean);
  if (filtered.length === 0) return [...defaultScopes];
  return filtered;
}

function ensureScopes(scopes: string[]) {
  const unsupported = scopes.filter((scope) => !supportedScopes.includes(scope));
  if (unsupported.length > 0) {
    throw createOAuthError(
      "invalid_scope",
      `Unsupported scopes requested: ${unsupported.join(", ")}`
    );
  }
}

function createOAuthError(error: string, description: string) {
  return Object.assign(new Error(description), {
    oauthError: error,
    errorDescription: description,
  });
}

function ensureClient(clientId: string) {
  const client = clients.get(clientId);
  if (!client) {
    throw createOAuthError(
      "unauthorized_client",
      `Unknown client_id "${clientId}".`
    );
  }
  return client;
}

function validateRedirectUri(client: OAuthClient, redirectUri: string) {
  if (!redirectUri) {
    throw createOAuthError("invalid_request", "redirect_uri is required.");
  }
  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw createOAuthError("invalid_request", "redirect_uri must be absolute.");
  }

  if (!["https:", "http:"].includes(redirect.protocol)) {
    throw createOAuthError(
      "invalid_request",
      "redirect_uri must use http or https."
    );
  }

  if (
    redirect.protocol !== "https:" &&
    redirect.hostname !== "localhost" &&
    redirect.hostname !== "127.0.0.1"
  ) {
    throw createOAuthError(
      "invalid_request",
      "Non-HTTPS redirect_uris are only allowed for localhost."
    );
  }

  if (!client.redirectUris.includes(redirect.toString())) {
    throw createOAuthError(
      "invalid_request",
      `redirect_uri "${redirectUri}" is not registered for client_id "${client.clientId}".`
    );
  }

  return redirect.toString();
}

export function registerClient(input: {
  client_name?: string;
  redirect_uris?: string[];
  scope?: string;
}) {
  const redirectUris = input.redirect_uris ?? [];
  if (redirectUris.length === 0) {
    throw createOAuthError(
      "invalid_client_metadata",
      "redirect_uris must be provided during registration."
    );
  }

  for (const uri of redirectUris) {
    validateRedirectUri(
      {
        clientId: "registration-validation",
        clientName: input.client_name,
        redirectUris: redirectUris.map((value) => value.trim()),
        scopes: [...defaultScopes],
        clientIdIssuedAt: Math.floor(Date.now() / 1000),
      },
      uri
    );
  }

  const clientId = generateId("client");
  const scopes = input.scope
    ? Array.from(new Set(input.scope.split(/\s+/).filter(Boolean)))
    : [...defaultScopes];
  ensureScopes(scopes);

  const client: OAuthClient = {
    clientId,
    clientName: input.client_name,
    redirectUris: redirectUris.map((value) => value.trim()),
    scopes,
    clientIdIssuedAt: Math.floor(Date.now() / 1000),
  };

  clients.set(clientId, client);
  persistClients();

  return {
    client_id: clientId,
    client_id_issued_at: client.clientIdIssuedAt,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: client.redirectUris,
    scope: scopes.join(" "),
  };
}

export function prepareAuthorization(context: {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string | string[];
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
  nonce?: string;
  authorizeUri: string;
  completeUri: string;
}) {
  cleanupExpiredRecords();

  const rawResponseTypes =
    context.response_type?.split(/\s+/).filter(Boolean) ?? ["code"];
  const responseTypes = rawResponseTypes.map((type) => type.toLowerCase());

  if (!responseTypes.includes("code")) {
    throw createOAuthError(
      "unsupported_response_type",
      "Only response types that include \"code\" are supported."
    );
  }

  const unsupportedResponseTypes = responseTypes.filter(
    (type) => type !== "code"
  );
  if (unsupportedResponseTypes.length > 0) {
    console.warn(
      `Ignoring unsupported response types requested: ${unsupportedResponseTypes.join(
        ", "
      )}`
    );
  }

  const resolvedClientId =
    context.client_id ??
    (staticClientIds.length === 1 ? staticClientIds[0] : undefined);

  if (!resolvedClientId) {
    throw createOAuthError("invalid_request", "client_id is required.");
  }
  if (!context.client_id && staticClientIds.length === 1) {
    console.warn("[oauth] Missing client_id; defaulting to configured client", resolvedClientId);
  }

  const trimmedChallenge =
    typeof context.code_challenge === "string"
      ? context.code_challenge.trim()
      : undefined;
  const hasChallenge = Boolean(trimmedChallenge);
  const normalizedMethod =
    typeof context.code_challenge_method === "string"
      ? context.code_challenge_method.toUpperCase()
      : undefined;

  if (!hasChallenge) {
    console.warn("[oauth] Missing code_challenge; proceeding without PKCE validation.");
  }

  if (hasChallenge && !normalizedMethod) {
    console.warn("[oauth] Missing code_challenge_method; assuming S256.");
  }

  if (normalizedMethod && normalizedMethod !== "S256") {
    throw createOAuthError(
      "invalid_request",
      "Only S256 code_challenge_method is supported."
    );
  }

  const client = ensureClient(resolvedClientId);
  const redirectUri = validateRedirectUri(client, context.redirect_uri ?? "");
  const requestedScopes = normalizeScope(context.scope);
  ensureScopes(requestedScopes);

  const suppliedState =
    typeof context.state === "string" && context.state.trim().length > 0
      ? context.state
      : undefined;
  const state = suppliedState ?? generateId("state");

  const requestedResource =
    typeof context.resource === "string" && context.resource.length > 0
      ? context.resource
      : resourceIndicator;
  const normalizedResource = requestedResource.replace(/\/$/, "");
  if (normalizedResource !== canonicalResourceIndicator) {
    throw createOAuthError(
      "invalid_target",
      "Unsupported resource indicator."
    );
  }
  const resource = resourceIndicator;

  const record: AuthorizationRequestRecord = {
    clientId: client.clientId,
    redirectUri,
    scope: requestedScopes,
    state,
    clientSuppliedState: suppliedState,
    codeChallenge: hasChallenge ? trimmedChallenge : undefined,
    codeChallengeMethod: hasChallenge ? "S256" : undefined,
    resource,
    nonce: context.nonce,
    createdAt: Date.now(),
  };

  authorizationRequests.set(state, record);

  const pageContext: AuthorizationPageContext = {
    state,
    clientId: client.clientId,
    clientName: client.clientName,
    scope: requestedScopes,
    resource,
    redirectUri,
    authorizeUri: context.authorizeUri,
    completeUri: context.completeUri,
    issuer,
    privyAppId,
    privyClientId,
  };

  return pageContext;
}

export async function completeAuthorization(input: {
  state: string;
  privyToken: string;
  fallbackToken?: string;
}) {
  cleanupExpiredRecords();

  const record = authorizationRequests.get(input.state);

  if (!record) {
    throw createOAuthError("invalid_request", "Unknown or expired state.");
  }

  authorizationRequests.delete(input.state);

  console.log('[oauth] Completing authorization for state', input.state, 'token preview', `${input.privyToken.slice(0, 8)}...${input.privyToken.slice(-8)}`);

  let tokenUsed = input.privyToken;
  let privyClaims;
  try {
    privyClaims = await verifyPrivyToken(input.privyToken);
  } catch (error) {
    if (input.fallbackToken) {
      console.warn('[oauth] Primary token verification failed, trying fallback token', `${input.fallbackToken.slice(0, 8)}...${input.fallbackToken.slice(-8)}`);
      tokenUsed = input.fallbackToken;
      privyClaims = await verifyPrivyToken(input.fallbackToken);
    } else {
      throw error;
    }
  }

  const code = generateId("code");

  authorizationCodes.set(code, {
    code,
    clientId: record.clientId,
    redirectUri: record.redirectUri,
    scope: record.scope,
    clientSuppliedState: record.clientSuppliedState,
    resource: record.resource,
    codeChallenge: record.codeChallenge,
    codeChallengeMethod: record.codeChallengeMethod,
    privyClaims,
    privyToken: tokenUsed,
    createdAt: Date.now(),
  });

  const redirect = new URL(record.redirectUri);
  redirect.searchParams.set("code", code);
  if (record.clientSuppliedState) {
    redirect.searchParams.set("state", record.clientSuppliedState);
  }

  return {
    code,
    redirectUri: redirect.toString(),
  };
}

function issueTokens(payload: TokenIssuePayload) {
  const now = Date.now();
  const accessToken = randomBytes(32).toString("base64url");
  const includeRefresh = payload.scope.includes("offline_access");
  const refreshToken = includeRefresh
    ? randomBytes(32).toString("base64url")
    : undefined;

  const accessRecord: AccessTokenRecord = {
    token: accessToken,
    clientId: payload.clientId,
    scope: payload.scope,
    resource: payload.resource,
    privyClaims: payload.privyClaims,
    privyToken: payload.privyToken,
    createdAt: now,
    expiresAt: now + accessTokenTtlSeconds * 1000,
    refreshToken,
  };

  accessTokens.set(accessToken, accessRecord);

  if (includeRefresh && refreshToken) {
    const refreshRecord: RefreshTokenRecord = {
      token: refreshToken,
      clientId: payload.clientId,
      scope: payload.scope,
      resource: payload.resource,
      privyClaims: payload.privyClaims,
      privyToken: payload.privyToken,
      createdAt: now,
      expiresAt: now + refreshTokenTtlSeconds * 1000,
      accessToken,
    };
    refreshTokens.set(refreshToken, refreshRecord);
  }

  return {
    access_token: accessToken,
    token_type: "Bearer" as const,
    expires_in: accessTokenTtlSeconds,
    refresh_token: includeRefresh ? refreshToken : undefined,
    scope: payload.scope.join(" "),
  };
}

export function exchangeCodeForTokens(input: {
  code?: string;
  code_verifier?: string;
  client_id?: string;
  redirect_uri?: string;
}) {
  cleanupExpiredRecords();

  if (!input.code) {
    throw createOAuthError("invalid_request", "code is required.");
  }
  if (!input.code_verifier) {
    throw createOAuthError("invalid_request", "code_verifier is required.");
  }
  if (!input.redirect_uri) {
    throw createOAuthError("invalid_request", "redirect_uri is required.");
  }

  const record = authorizationCodes.get(input.code);
  if (!record) {
    throw createOAuthError("invalid_grant", "Unknown or expired authorization code.");
  }

  const clientId = input.client_id ?? record.clientId;
  if (!clientId) {
    throw createOAuthError("invalid_request", "client_id is required.");
  }
  if (!input.client_id && clientId === record.clientId) {
    console.warn("[oauth] Token exchange missing client_id; using authorization record client", clientId);
  }

  if (record.clientId !== clientId) {
    throw createOAuthError("invalid_grant", "client_id mismatch.");
  }

  if (record.redirectUri !== input.redirect_uri) {
    throw createOAuthError("invalid_grant", "redirect_uri mismatch.");
  }

  if (record.createdAt + authorizationCodeTtlSeconds * 1000 < Date.now()) {
    authorizationCodes.delete(input.code);
    throw createOAuthError("invalid_grant", "Authorization code expired.");
  }

  if (record.codeChallenge) {
    const computedChallenge = calculateCodeChallenge(input.code_verifier);
    if (computedChallenge !== record.codeChallenge) {
      authorizationCodes.delete(input.code);
      throw createOAuthError("invalid_grant", "Invalid code_verifier.");
    }
  } else {
    console.warn("[oauth] Authorization code issued without PKCE; skipping verifier check.");
  }

  authorizationCodes.delete(input.code);

  return issueTokens({
    clientId: record.clientId,
    scope: record.scope,
    resource: record.resource,
    privyClaims: record.privyClaims,
    privyToken: record.privyToken,
  });
}

export function refreshAccessToken(input: {
  refresh_token?: string;
  client_id?: string;
  scope?: string;
}) {
  cleanupExpiredRecords();

  if (!input.refresh_token) {
    throw createOAuthError("invalid_request", "refresh_token is required.");
  }
  const record = refreshTokens.get(input.refresh_token);

  if (!record) {
    throw createOAuthError("invalid_grant", "Unknown refresh token.");
  }

  const clientId = input.client_id ?? record.clientId;
  if (!clientId) {
    throw createOAuthError("invalid_request", "client_id is required.");
  }
  if (!input.client_id && clientId === record.clientId) {
    console.warn("[oauth] Refresh token request missing client_id; using original client", clientId);
  }

  if (record.clientId !== clientId) {
    throw createOAuthError("invalid_grant", "client_id mismatch.");
  }

  if (record.expiresAt <= Date.now()) {
    refreshTokens.delete(input.refresh_token);
    if (record.accessToken) {
      accessTokens.delete(record.accessToken);
    }
    throw createOAuthError("invalid_grant", "Refresh token expired.");
  }

  const requestedScopes = input.scope
    ? normalizeScope(input.scope)
    : record.scope;
  ensureScopes(requestedScopes);

  for (const scope of requestedScopes) {
    if (!record.scope.includes(scope)) {
      throw createOAuthError(
        "invalid_scope",
        "Requested scope exceeds originally granted scopes."
      );
    }
  }

  refreshTokens.delete(input.refresh_token);
  if (record.accessToken) {
    accessTokens.delete(record.accessToken);
  }

  return issueTokens({
    clientId: record.clientId,
    scope: requestedScopes,
    resource: record.resource,
    privyClaims: record.privyClaims,
    privyToken: record.privyToken,
  });
}

export function revokeToken(input: { token?: string; token_type_hint?: string }) {
  if (!input.token) {
    return;
  }

  if (input.token_type_hint === "refresh_token") {
    const refresh = refreshTokens.get(input.token);
    if (refresh?.accessToken) {
      accessTokens.delete(refresh.accessToken);
    }
    refreshTokens.delete(input.token);
    return;
  }

  if (input.token_type_hint === "access_token") {
    const access = accessTokens.get(input.token);
    if (access?.refreshToken) {
      refreshTokens.delete(access.refreshToken);
    }
    accessTokens.delete(input.token);
    return;
  }

  const access = accessTokens.get(input.token);
  if (access) {
    if (access.refreshToken) {
      refreshTokens.delete(access.refreshToken);
    }
    accessTokens.delete(input.token);
    return;
  }

  const refresh = refreshTokens.get(input.token);
  if (refresh) {
    if (refresh.accessToken) {
      accessTokens.delete(refresh.accessToken);
    }
    refreshTokens.delete(input.token);
  }
}

export function validateAccessToken(token: string) {
  cleanupExpiredRecords();
  const record = accessTokens.get(token);
  if (!record) {
    return {
      valid: false as const,
      error: "unknown" as const,
      message: "Unknown access token.",
    };
  }

  if (record.expiresAt <= Date.now()) {
    accessTokens.delete(token);
    if (record.refreshToken) {
      const refresh = refreshTokens.get(record.refreshToken);
      if (refresh) {
        refreshTokens.delete(refresh.token);
      }
    }
    return {
      valid: false as const,
      error: "expired" as const,
      message: "Access token expired.",
    };
  }

  return {
    valid: true as const,
    claims: record.privyClaims,
    clientId: record.clientId,
    scope: record.scope,
    resource: record.resource,
    expiresAt: record.expiresAt,
  };
}

export type AccessTokenValidation =
  | {
      valid: true;
      claims: VerifyAuthTokenResponse;
      clientId: string;
      scope: string[];
      resource?: string;
      expiresAt: number;
    }
  | {
      valid: false;
      error: "unknown" | "expired";
      message: string;
    };

export function authorizationServerMetadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer.replace(/\/$/, "")}/oauth/authorize`,
    token_endpoint: `${issuer.replace(/\/$/, "")}/oauth/token`,
    registration_endpoint: `${issuer.replace(/\/$/, "")}/oauth/register`,
    revocation_endpoint: `${issuer.replace(/\/$/, "")}/oauth/revoke`,
    userinfo_endpoint: `${issuer.replace(/\/$/, "")}/oauth/userinfo`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: supportedScopes,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function protectedResourceMetadata() {
  return {
    resource: resourceIndicator,
    authorization_servers: [issuer],
    scopes_supported: supportedScopes,
  };
}

export function listSupportedScopes() {
  return [...supportedScopes];
}

export function serializeAuthorizationContext(context: AuthorizationPageContext) {
  return JSON.stringify(context).replace(/</g, "\u003c");
}
