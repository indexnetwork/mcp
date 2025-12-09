/**
 * OAuth Repository Factory
 *
 * Provides the appropriate repository implementations based on configuration.
 * - AUTH_STORAGE_DRIVER=postgres: Use PostgreSQL for refresh tokens and access token sessions
 * - AUTH_STORAGE_DRIVER=memory (or unset): Use in-memory storage
 *
 * Authorization codes always use in-memory storage (30s lifetime, not worth persisting)
 */

import { isPostgresConfigured } from '../../db/pg.js';
import {
  InMemoryClientRepository,
  InMemoryAuthorizationCodeRepository,
  InMemoryRefreshTokenRepository,
  InMemoryAccessTokenSessionRepository,
  createInMemoryRepositories,
} from './inMemory.js';
import {
  PostgresClientRepository,
  PostgresRefreshTokenRepository,
  PostgresAccessTokenSessionRepository,
} from './postgres.js';
import type { AuthRepositories } from './types.js';

export type { AuthRepositories } from './types.js';
export type {
  OAuthClientRecord,
  ClientRepository,
  AuthorizationCodeRecord,
  AuthorizationCodeRepository,
  RefreshTokenRecord,
  RefreshTokenRepository,
  AccessTokenSessionRecord,
  AccessTokenSessionRepository,
} from './types.js';

// Re-export in-memory implementations for testing
export {
  InMemoryClientRepository,
  InMemoryAuthorizationCodeRepository,
  InMemoryRefreshTokenRepository,
  InMemoryAccessTokenSessionRepository,
} from './inMemory.js';

/**
 * Get the configured storage driver
 */
export function getStorageDriver(): 'memory' | 'postgres' {
  const driver = process.env.AUTH_STORAGE_DRIVER;

  if (driver === 'postgres') {
    if (!isPostgresConfigured()) {
      console.warn('[auth] AUTH_STORAGE_DRIVER=postgres but DATABASE_URL not set, falling back to memory');
      return 'memory';
    }
    return 'postgres';
  }

  return 'memory';
}

// Singleton repositories instance
let repositories: AuthRepositories | null = null;

/**
 * Create or return the singleton repositories instance
 */
export function getRepositories(): AuthRepositories {
  if (repositories) {
    return repositories;
  }

  const driver = getStorageDriver();
  console.log(`[auth] Initializing auth repositories with driver: ${driver}`);

  if (driver === 'postgres') {
    // Auth codes stay in-memory (short-lived)
    // Clients, refresh tokens and access token sessions use postgres
    repositories = {
      clients: new PostgresClientRepository(),
      authorizationCodes: new InMemoryAuthorizationCodeRepository(),
      refreshTokens: new PostgresRefreshTokenRepository(),
      accessTokenSessions: new PostgresAccessTokenSessionRepository(),
    };
  } else {
    // All in-memory
    repositories = createInMemoryRepositories();
  }

  return repositories!;
}

/**
 * Reset repositories (for testing)
 */
export function resetRepositories(): void {
  repositories = null;
}

/**
 * Create fresh repositories instances (for testing or custom setup)
 */
export function createRepositories(driver: 'memory' | 'postgres' = 'memory'): AuthRepositories {
  if (driver === 'postgres') {
    return {
      clients: new PostgresClientRepository(),
      authorizationCodes: new InMemoryAuthorizationCodeRepository(),
      refreshTokens: new PostgresRefreshTokenRepository(),
      accessTokenSessions: new PostgresAccessTokenSessionRepository(),
    };
  }

  return createInMemoryRepositories();
}
