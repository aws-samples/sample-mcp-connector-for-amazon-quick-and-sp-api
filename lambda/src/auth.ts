// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// LWA (Login with Amazon) auth for SP-API.
// SP-API uses the OAuth2 refresh_token grant and expects the token in the
// `x-amz-access-token` header. (SP-API no longer requires AWS SigV4 signing.)
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const sm = new SecretsManagerClient({});

export interface LwaCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

let cachedCreds: LwaCredentials | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Load LWA credentials from Secrets Manager (JSON with LWA_CLIENT_ID / LWA_CLIENT_SECRET / SP_API_REFRESH_TOKEN). */
export async function loadCredentials(secretId: string): Promise<LwaCredentials> {
  if (cachedCreds) return cachedCreds;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`Secret ${secretId} has no SecretString`);
  let p: Record<string, string>;
  try {
    p = JSON.parse(res.SecretString);
  } catch {
    // Never let a parse error quote part of the secret into the logs.
    throw new Error(`Secret ${secretId} is not valid JSON`);
  }
  cachedCreds = {
    clientId: p.LWA_CLIENT_ID,
    clientSecret: p.LWA_CLIENT_SECRET,
    refreshToken: p.SP_API_REFRESH_TOKEN,
  };
  return cachedCreds;
}

/** Exchange the refresh token for a short-lived LWA access token (cached until ~1 min before expiry). */
export async function getAccessToken(secretId: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const creds = await loadCredentials(secretId);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const resp = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    // Report only the OAuth error code (e.g. invalid_grant), never the response body.
    let code = "";
    try {
      const err = (await resp.json()) as { error?: unknown };
      if (typeof err.error === "string" && /^[a-z_]{1,64}$/.test(err.error)) code = ` (${err.error})`;
    } catch {
      /* non-JSON body */
    }
    throw new Error(`LWA token exchange failed: HTTP ${resp.status}${code}`);
  }
  const json = (await resp.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}
