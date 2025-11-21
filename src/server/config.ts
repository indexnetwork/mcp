/**
 * Server configuration
 * Bun automatically loads .env files - no need for dotenv
 */

// Validate required environment variables (skip in test mode)
const requiredEnvVars = [
  'PRIVY_APP_ID',
  'PRIVY_APP_SECRET',
  'SERVER_BASE_URL',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'PROTOCOL_API_URL'
];

if (process.env.NODE_ENV !== 'test') {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

// Test mode defaults
const isTest = process.env.NODE_ENV === 'test';
const testDefaults = {
  PRIVY_APP_ID: 'test-app-id',
  PRIVY_APP_SECRET: 'test-app-secret',
  SERVER_BASE_URL: 'http://localhost:3002',
  JWT_PRIVATE_KEY: Buffer.from('test-private-key').toString('base64'),
  JWT_PUBLIC_KEY: Buffer.from('test-public-key').toString('base64'),
  PROTOCOL_API_URL: 'http://localhost:3000',
};

export const config = {
  // Privy configuration
  privy: {
    appId: process.env.PRIVY_APP_ID ?? (isTest ? testDefaults.PRIVY_APP_ID : ''),
    appSecret: process.env.PRIVY_APP_SECRET ?? (isTest ? testDefaults.PRIVY_APP_SECRET : ''),
  },

  // Server configuration
  server: {
    baseUrl: process.env.SERVER_BASE_URL ?? (isTest ? testDefaults.SERVER_BASE_URL : ''),
    port: parseInt(process.env.PORT || '3002'),
    nodeEnv: process.env.NODE_ENV || 'development',
  },

  // JWT configuration
  jwt: {
    privateKey: Buffer.from(
      process.env.JWT_PRIVATE_KEY ?? (isTest ? testDefaults.JWT_PRIVATE_KEY : ''),
      'base64'
    ).toString('utf-8'),
    publicKey: Buffer.from(
      process.env.JWT_PUBLIC_KEY ?? (isTest ? testDefaults.JWT_PUBLIC_KEY : ''),
      'base64'
    ).toString('utf-8'),
    issuer: process.env.SERVER_BASE_URL ?? (isTest ? testDefaults.SERVER_BASE_URL : ''),
    algorithm: 'RS256' as const,
    expiresIn: '1h',
  },

  // OAuth configuration
  oauth: {
    authorizationEndpoint: `${process.env.SERVER_BASE_URL ?? (isTest ? testDefaults.SERVER_BASE_URL : '')}/authorize`,
    tokenEndpoint: `${process.env.SERVER_BASE_URL ?? (isTest ? testDefaults.SERVER_BASE_URL : '')}/token`,
    jwksEndpoint: `${process.env.SERVER_BASE_URL ?? (isTest ? testDefaults.SERVER_BASE_URL : '')}/.well-known/jwks.json`,
    registrationEndpoint: `${process.env.SERVER_BASE_URL ?? (isTest ? testDefaults.SERVER_BASE_URL : '')}/register`,
    scopesSupported: ['read', 'write', 'profile', 'privy:token:exchange'],
  },

  // Intent extraction configuration
  intentExtraction: {
    protocolApiUrl: process.env.PROTOCOL_API_URL ?? (isTest ? testDefaults.PROTOCOL_API_URL : ''),
    protocolApiTimeoutMs: Number(process.env.PROTOCOL_API_TIMEOUT_MS ?? '60000'),
    privyTokenExchangeTimeoutMs: Number(process.env.PRIVY_TOKEN_EXCHANGE_TIMEOUT_MS ?? '10000'),
    sectionCharLimit: Number(process.env.EXTRACT_INTENT_SECTION_CHAR_LIMIT ?? '5000'),
    instructionCharLimit: Number(process.env.EXTRACT_INTENT_INSTRUCTION_CHAR_LIMIT ?? '2000'),
  },
} as const;

// Helper to check if we're in production
export const isProduction = config.server.nodeEnv === 'production';
export const isDevelopment = config.server.nodeEnv === 'development';
