/**
 * In-memory implementations of OAuth repositories
 * Used for testing and development when DATABASE_URL is not configured
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  OAuthClientRecord,
  ClientRepository,
  AuthorizationCodeRecord,
  AuthorizationCodeRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  AccessTokenSessionRecord,
  AccessTokenSessionRepository,
} from './types.js';

// ============================================================================
// OAuth Client Repository (In-Memory)
// ============================================================================

export class InMemoryClientRepository implements ClientRepository {
  private clients = new Map<string, OAuthClientRecord>();

  async create(data: Omit<OAuthClientRecord, 'createdAt'>): Promise<OAuthClientRecord> {
    const record: OAuthClientRecord = {
      ...data,
      createdAt: new Date(),
    };
    this.clients.set(data.id, record);
    return record;
  }

  async findById(id: string): Promise<OAuthClientRecord | null> {
    return this.clients.get(id) ?? null;
  }

  async findByIdAndRedirectUri(id: string, redirectUri: string): Promise<OAuthClientRecord | null> {
    const client = this.clients.get(id);
    if (!client) return null;
    return client.redirectUris.includes(redirectUri) ? client : null;
  }
}

// ============================================================================
// Utility functions
// ============================================================================

function generateSecureCode(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateSecureToken(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Authorization Code Repository (In-Memory)
// ============================================================================

export class InMemoryAuthorizationCodeRepository implements AuthorizationCodeRepository {
  private codes = new Map<string, AuthorizationCodeRecord>();

  async create(data: Omit<AuthorizationCodeRecord, 'code' | 'used' | 'createdAt'>): Promise<string> {
    const code = generateSecureCode();
    const record: AuthorizationCodeRecord = {
      ...data,
      code,
      used: false,
      createdAt: new Date(),
    };
    this.codes.set(code, record);
    return code;
  }

  async findByCode(code: string): Promise<AuthorizationCodeRecord | null> {
    return this.codes.get(code) ?? null;
  }

  async markAsUsed(code: string): Promise<void> {
    const record = this.codes.get(code);
    if (record) {
      record.used = true;
    }
  }

  async delete(code: string): Promise<void> {
    this.codes.delete(code);
  }

  async cleanupExpired(now: Date = new Date()): Promise<void> {
    for (const [code, record] of this.codes.entries()) {
      if (record.expiresAt < now || record.used) {
        this.codes.delete(code);
      }
    }
  }
}

// ============================================================================
// Refresh Token Repository (In-Memory)
// ============================================================================

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private tokens = new Map<string, RefreshTokenRecord>();

  async create(data: Omit<RefreshTokenRecord, 'id' | 'createdAt' | 'revokedAt'>): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      ...data,
      id: uuidv4(),
      revokedAt: null,
      createdAt: new Date(),
    };
    this.tokens.set(data.token, record);
    return record;
  }

  async findByToken(rawToken: string): Promise<RefreshTokenRecord | null> {
    return this.tokens.get(rawToken) ?? null;
  }

  async revokeByToken(token: string): Promise<void> {
    const record = this.tokens.get(token);
    if (record) {
      record.revokedAt = new Date();
    }
  }

  async revokeById(id: string): Promise<void> {
    for (const record of this.tokens.values()) {
      if (record.id === id) {
        record.revokedAt = new Date();
        break;
      }
    }
  }

  async cleanupExpired(now: Date = new Date()): Promise<void> {
    for (const [token, record] of this.tokens.entries()) {
      if (record.expiresAt < now || record.revokedAt !== null) {
        this.tokens.delete(token);
      }
    }
  }

  // For token rotation: delete the old token entirely
  async deleteByToken(token: string): Promise<void> {
    this.tokens.delete(token);
  }
}

// ============================================================================
// Access Token Session Repository (In-Memory)
// ============================================================================

export class InMemoryAccessTokenSessionRepository implements AccessTokenSessionRepository {
  private sessions = new Map<string, AccessTokenSessionRecord>();

  async create(data: Omit<AccessTokenSessionRecord, 'id' | 'createdAt'>): Promise<AccessTokenSessionRecord> {
    const record: AccessTokenSessionRecord = {
      ...data,
      id: uuidv4(),
      createdAt: new Date(),
    };
    this.sessions.set(data.jti, record);
    return record;
  }

  async findByJti(jti: string): Promise<AccessTokenSessionRecord | null> {
    return this.sessions.get(jti) ?? null;
  }

  async deleteByJti(jti: string): Promise<void> {
    this.sessions.delete(jti);
  }

  async cleanupExpired(now: Date = new Date()): Promise<void> {
    for (const [jti, record] of this.sessions.entries()) {
      if (record.expiresAt < now) {
        this.sessions.delete(jti);
      }
    }
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createInMemoryRepositories() {
  return {
    clients: new InMemoryClientRepository(),
    authorizationCodes: new InMemoryAuthorizationCodeRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    accessTokenSessions: new InMemoryAccessTokenSessionRepository(),
  };
}
