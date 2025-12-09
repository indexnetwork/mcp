/**
 * PostgreSQL database client
 * Uses connection pooling for efficient database access
 */

import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Get the database URL from environment
 * Returns null if not configured (allows graceful fallback to in-memory)
 */
function getDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return null;
  }
  return url;
}

/**
 * Initialize and return the connection pool
 * Throws if DATABASE_URL is not configured
 */
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured');
    }

    pool = new Pool({
      connectionString,
      // Connection pool settings
      max: 10, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection not established
    });

    // Log pool errors (but don't expose connection details)
    pool.on('error', (err) => {
      console.error('[pg] Unexpected error on idle client:', err.message);
    });

    console.log('[pg] Database pool initialized');
  }

  return pool;
}

/**
 * Check if postgres is configured
 */
export function isPostgresConfigured(): boolean {
  return getDatabaseUrl() !== null;
}

/**
 * Execute a query against the database
 */
export async function query<T = any>(
  text: string,
  params: any[] = []
): Promise<{ rows: T[]; rowCount: number | null }> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount,
  };
}

/**
 * Execute a query and return the first row or null
 */
export async function queryOne<T = any>(
  text: string,
  params: any[] = []
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Close the connection pool
 * Call this on graceful shutdown
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[pg] Database pool closed');
  }
}

/**
 * Test the database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as ok');
    return result.rows[0]?.ok === 1;
  } catch (error) {
    console.error('[pg] Connection test failed:', error instanceof Error ? error.message : error);
    return false;
  }
}
