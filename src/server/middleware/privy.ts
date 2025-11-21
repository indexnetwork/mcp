/**
 * Privy Token Verification Middleware
 * Verifies Privy JWT tokens from the frontend using Privy SDK
 */

import { Request, Response, NextFunction } from 'express';
import { PrivyClient } from '@privy-io/server-auth';
import { config } from '../config.js';

// Extend Express Request to include Privy user info
declare global {
  namespace Express {
    interface Request {
      privyUser?: {
        userId: string;
        appId: string;
      };
    }
  }
}

// Initialize Privy client (singleton)
const privyClient = new PrivyClient(
  config.privy.appId,
  config.privy.appSecret
);

/**
 * Middleware to verify Privy JWT tokens
 * Used for backend routes that receive tokens from the Privy-authenticated frontend
 *
 * SECURITY: Uses Privy SDK to properly verify token signatures
 */
export async function verifyPrivyToken(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Missing or invalid Authorization header',
      });
    }

    const token = authHeader.substring(7);

    try {
      // Verify token using Privy SDK - this properly checks the signature
      const claims = await privyClient.verifyAuthToken(token);

      if (!claims || !claims.userId) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Invalid Privy token',
        });
      }

      // Attach Privy user info to request
      req.privyUser = {
        userId: claims.userId, // Privy DID (e.g., "did:privy:...")
        appId: claims.appId,
      };

      next();
    } catch (error) {
      // Privy SDK throws errors for invalid tokens
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Privy token verification failed:', errorMessage);

      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Failed to verify Privy token',
      });
    }
  } catch (error) {
    console.error('Privy token verification error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred while verifying the Privy token',
    });
  }
}

