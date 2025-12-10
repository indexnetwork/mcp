/**
 * PostgreSQL implementations of OAuth repositories
 * Used in production when DATABASE_URL is configured
 *
 * Schema (create these tables in your database):
 *
 * CREATE TABLE oauth_clients (
 *   id TEXT PRIMARY KEY,           -- client_id (e.g. "client_..." or "chatgpt-connector")
 *   client_name TEXT,
 *   redirect_uris TEXT[] NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 *
 * CREATE TABLE oauth_refresh_tokens (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   token TEXT NOT NULL,
 *   client_id TEXT NOT NULL,
 *   privy_user_id TEXT NOT NULL,
 *   scopes TEXT[] NOT NULL,
 *   privy_access_token TEXT NOT NULL,
 *   expires_at TIMESTAMPTZ NOT NULL,
 *   revoked_at TIMESTAMPTZ,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 *
 * CREATE INDEX oauth_refresh_tokens_token_idx ON oauth_refresh_tokens (token);
 * CREATE INDEX oauth_refresh_tokens_user_client_idx ON oauth_refresh_tokens (privy_user_id, client_id);
 *
 * CREATE TABLE oauth_access_token_sessions (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   jti TEXT NOT NULL UNIQUE,
 *   client_id TEXT NOT NULL,
 *   privy_user_id TEXT NOT NULL,
 *   scopes TEXT[] NOT NULL,
 *   privy_access_token TEXT NOT NULL,
 *   expires_at TIMESTAMPTZ NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   privy_invalid_at TIMESTAMPTZ  -- Set when privy token is known to be invalid/expired
 * );
 *
 * CREATE INDEX oauth_access_token_sessions_jti_idx ON oauth_access_token_sessions (jti);
 */

import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../db/pg.js';
import type {
  OAuthClientRecord,
  ClientRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  AccessTokenSessionRecord,
  AccessTokenSessionRepository,
} from './types.js';

// ============================================================================
// OAuth Client Repository (PostgreSQL)
// ============================================================================

export class PostgresClientRepository implements ClientRepository {
  async create(data: Omit<OAuthClientRecord, 'createdAt'>): Promise<OAuthClientRecord> {
    const createdAt = new Date();

    // Use ON CONFLICT to handle re-registration of the same client
    await query(
      `INSERT INTO oauth_clients (id, client_name, redirect_uris, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         client_name = EXCLUDED.client_name,
         redirect_uris = EXCLUDED.redirect_uris`,
      [data.id, data.clientName ?? null, data.redirectUris, createdAt]
    );

    return {
      id: data.id,
      clientName: data.clientName,
      redirectUris: data.redirectUris,
      createdAt,
    };
  }

  async findById(id: string): Promise<OAuthClientRecord | null> {
    const row = await queryOne<{
      id: string;
      client_name: string | null;
      redirect_uris: string[];
      created_at: Date;
    }>(
      `SELECT id, client_name, redirect_uris, created_at
       FROM oauth_clients
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    if (!row) return null;

    return {
      id: row.id,
      clientName: row.client_name ?? undefined,
      redirectUris: row.redirect_uris,
      createdAt: row.created_at,
    };
  }

  async findByIdAndRedirectUri(id: string, redirectUri: string): Promise<OAuthClientRecord | null> {
    const row = await queryOne<{
      id: string;
      client_name: string | null;
      redirect_uris: string[];
      created_at: Date;
    }>(
      `SELECT id, client_name, redirect_uris, created_at
       FROM oauth_clients
       WHERE id = $1 AND $2 = ANY(redirect_uris)
       LIMIT 1`,
      [id, redirectUri]
    );

    if (!row) return null;

    return {
      id: row.id,
      clientName: row.client_name ?? undefined,
      redirectUris: row.redirect_uris,
      createdAt: row.created_at,
    };
  }
}

// ============================================================================
// Refresh Token Repository (PostgreSQL)
// ============================================================================

export class PostgresRefreshTokenRepository implements RefreshTokenRepository {
  async create(data: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>): Promise<RefreshTokenRecord> {
    const id = uuidv4();
    const createdAt = new Date();

    await query(
      `INSERT INTO oauth_refresh_tokens
       (id, token, client_id, privy_user_id, scopes, privy_access_token, expires_at, revoked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
      [
        id,
        data.token,
        data.clientId,
        data.privyUserId,
        data.scopes,
        data.privyAccessToken,
        data.expiresAt,
        createdAt,
      ]
    );

    return {
      id,
      token: data.token,
      clientId: data.clientId,
      privyUserId: data.privyUserId,
      scopes: data.scopes,
      privyAccessToken: data.privyAccessToken,
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt,
    };
  }

  async findByToken(rawToken: string): Promise<RefreshTokenRecord | null> {
    const row = await queryOne<{
      id: string;
      token: string;
      client_id: string;
      privy_user_id: string;
      scopes: string[];
      privy_access_token: string;
      expires_at: Date;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, token, client_id, privy_user_id, scopes, privy_access_token, expires_at, revoked_at, created_at
       FROM oauth_refresh_tokens
       WHERE token = $1
       LIMIT 1`,
      [rawToken]
    );

    if (!row) return null;

    return {
      id: row.id,
      token: row.token,
      clientId: row.client_id,
      privyUserId: row.privy_user_id,
      scopes: row.scopes,
      privyAccessToken: row.privy_access_token,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    };
  }

  async revokeByToken(token: string): Promise<void> {
    await query(
      `UPDATE oauth_refresh_tokens
       SET revoked_at = NOW()
       WHERE token = $1`,
      [token]
    );
  }

  async revokeById(id: string): Promise<void> {
    await query(
      `UPDATE oauth_refresh_tokens
       SET revoked_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async revokeAllForUser(clientId: string, privyUserId: string, when: Date): Promise<void> {
    await query(
      `UPDATE oauth_refresh_tokens
       SET revoked_at = $3
       WHERE client_id = $1
         AND privy_user_id = $2
         AND revoked_at IS NULL`,
      [clientId, privyUserId, when]
    );
  }

  async cleanupExpired(now: Date = new Date()): Promise<void> {
    await query(
      `DELETE FROM oauth_refresh_tokens
       WHERE expires_at < $1 OR revoked_at IS NOT NULL`,
      [now]
    );
  }

  // For token rotation: delete the token entirely
  async deleteByToken(token: string): Promise<void> {
    await query(
      `DELETE FROM oauth_refresh_tokens
       WHERE token = $1`,
      [token]
    );
  }
}

// ============================================================================
// Access Token Session Repository (PostgreSQL)
// ============================================================================

export class PostgresAccessTokenSessionRepository implements AccessTokenSessionRepository {
  async create(data: Omit<AccessTokenSessionRecord, 'id' | 'createdAt'>): Promise<AccessTokenSessionRecord> {
    const id = uuidv4();
    const createdAt = new Date();

    await query(
      `INSERT INTO oauth_access_token_sessions
       (id, jti, client_id, privy_user_id, scopes, privy_access_token, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        data.jti,
        data.clientId,
        data.privyUserId,
        data.scopes,
        data.privyAccessToken,
        data.expiresAt,
        createdAt,
      ]
    );

    return {
      id,
      jti: data.jti,
      clientId: data.clientId,
      privyUserId: data.privyUserId,
      scopes: data.scopes,
      privyAccessToken: data.privyAccessToken,
      expiresAt: data.expiresAt,
      createdAt,
    };
  }

  async findByJti(jti: string): Promise<AccessTokenSessionRecord | null> {
    const row = await queryOne<{
      id: string;
      jti: string;
      client_id: string;
      privy_user_id: string;
      scopes: string[];
      privy_access_token: string;
      expires_at: Date;
      created_at: Date;
      privy_invalid_at: Date | null;
    }>(
      `SELECT id, jti, client_id, privy_user_id, scopes, privy_access_token, expires_at, created_at, privy_invalid_at
       FROM oauth_access_token_sessions
       WHERE jti = $1
       LIMIT 1`,
      [jti]
    );

    if (!row) return null;

    return {
      id: row.id,
      jti: row.jti,
      clientId: row.client_id,
      privyUserId: row.privy_user_id,
      scopes: row.scopes,
      privyAccessToken: row.privy_access_token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      privyInvalidAt: row.privy_invalid_at,
    };
  }

  async deleteByJti(jti: string): Promise<void> {
    await query(
      `DELETE FROM oauth_access_token_sessions
       WHERE jti = $1`,
      [jti]
    );
  }

  async cleanupExpired(now: Date = new Date()): Promise<void> {
    await query(
      `DELETE FROM oauth_access_token_sessions
       WHERE expires_at < $1`,
      [now]
    );
  }

  async markPrivyInvalid(jti: string, when: Date): Promise<void> {
    await query(
      `UPDATE oauth_access_token_sessions
       SET privy_invalid_at = $1
       WHERE jti = $2`,
      [when, jti]
    );
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createPostgresRepositories() {
  return {
    clients: new PostgresClientRepository(),
    refreshTokens: new PostgresRefreshTokenRepository(),
    accessTokenSessions: new PostgresAccessTokenSessionRepository(),
  };
}
