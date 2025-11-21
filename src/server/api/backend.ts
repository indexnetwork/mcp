/**
 * Backend API Integration
 * Calls the Protocol API with authentication
 */

import { config } from '../config.js';

/**
 * Call Protocol API with user context
 * @param privyUserId - User's Privy DID
 * @param endpoint - API endpoint path (e.g., '/items')
 * @param options - Fetch options (method, body, etc.)
 */
export async function callBackendAPI(
  privyUserId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `${config.intentExtraction.protocolApiUrl}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Privy-User-ID': privyUserId,
    ...(options.headers as Record<string, string>),
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Protocol API error: ${response.status} ${errorText}`);
    }

    // Handle different content types
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    } else {
      return response.text();
    }
  } catch (error) {
    console.error(`Protocol API call failed (${endpoint}):`, error);
    throw error;
  }
}

