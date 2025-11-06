import { PrivyClient } from "@privy-io/node";
import type { VerifyAuthTokenResponse } from "@privy-io/node";

const requiredEnv = ["PRIVY_APP_ID", "PRIVY_APP_SECRET"] as const;

const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  throw new Error(
    `Missing required Privy configuration. Set ${missingEnv.join(", ")} in your environment.`
  );
}

const privyClient = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
  jwtVerificationKey: process.env.PRIVY_JWT_VERIFICATION_KEY,
});

export const privyAppId = process.env.PRIVY_APP_ID!;
export const privyClientId = process.env.PRIVY_CLIENT_ID;

export function getPrivyClient() {
  return privyClient;
}

export async function verifyPrivyToken(
  token: string
): Promise<VerifyAuthTokenResponse> {
  const preview = `${token.slice(0, 8)}...${token.slice(-8)}`;
  console.log(`[privy] Verifying auth token ${preview}`);
  try {
    const [, payload] = token.split(".");
    if (payload) {
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, "=");
      const decoded = Buffer.from(padded, "base64").toString("utf8");
      const claims = JSON.parse(decoded);
      console.log("[privy] Token claims summary", {
        aud: claims?.aud,
        iss: claims?.iss,
        exp: claims?.exp,
        sid: claims?.sid
      });
    }
  } catch (claimError) {
    console.warn("[privy] Failed to parse token payload for logging", claimError);
  }
  try {
    return await privyClient.utils().auth().verifyAuthToken(token);
  } catch (error) {
    console.error('[privy] verifyAuthToken failed', error);
    throw error;
  }
}

export type { VerifyAuthTokenResponse };
