/**
 * OAuth PKCE utilities
 *
 * Note: Client registration, authorization codes, access tokens, and refresh tokens
 * are now managed through the repository pattern. See ./repositories/ for implementations.
 */

import { createHash } from 'crypto';

// PKCE utilities
export function validatePKCE(codeVerifier: string, codeChallenge: string): boolean {
  // For S256 method: base64url(sha256(code_verifier)) === code_challenge
  const hash = createSHA256Hash(codeVerifier);
  const computedChallenge = base64UrlEncode(hash);
  return computedChallenge === codeChallenge;
}

function createSHA256Hash(input: string): Uint8Array {
  const hash = createHash('sha256');
  hash.update(input);
  return new Uint8Array(hash.digest());
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
