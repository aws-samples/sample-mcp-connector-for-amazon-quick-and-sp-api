// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Thin SP-API request wrapper: regional endpoints, token injection, 429 backoff.
import { getAccessToken } from "./auth.js";

export const SP_API_ENDPOINTS = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
} as const;
export type Region = keyof typeof SP_API_ENDPOINTS;

// SP-API sandbox hosts. Auth (LWA refresh_token) is identical to production;
// only the host differs. The static sandbox returns canned responses when the
// request matches the operation's documented sample parameters.
export const SP_API_SANDBOX_ENDPOINTS = {
  NA: "https://sandbox.sellingpartnerapi-na.amazon.com",
  EU: "https://sandbox.sellingpartnerapi-eu.amazon.com",
  FE: "https://sandbox.sellingpartnerapi-fe.amazon.com",
} as const;

// NA marketplace IDs (this reference defaults to US).
export const MARKETPLACES = {
  US: "ATVPDKIKX0DER",
  CA: "A2EUQ1WTGCTBG2",
  MX: "A1AM78C64UM0Y8",
  BR: "A2Q3Y263D00KWC",
} as const;

export interface ClientConfig {
  region: Region;
  secretId: string;
  /** Route to the SP-API sandbox host instead of production. */
  sandbox?: boolean;
}

export interface SpApiRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callSpApi(cfg: ClientConfig, req: SpApiRequest): Promise<unknown> {
  const base = (cfg.sandbox ? SP_API_SANDBOX_ENDPOINTS : SP_API_ENDPOINTS)[cfg.region];

  // Tool arguments become path segments. encodeURIComponent leaves "." and ".." intact, and
  // the URL parser would resolve them (e.g. /orders/v0/orders/../orderItems -> /orders/v0/orderItems),
  // so a crafted argument could aim the call at a different operation. Reject any path the
  // parser rewrites, before a token is fetched. The message does not echo the argument.
  const url = new URL(base + req.path);
  if (url.origin !== new URL(base).origin || url.pathname !== req.path) {
    throw new Error("SP-API request rejected: a tool argument is not a valid path segment");
  }

  const token = await getAccessToken(cfg.secretId);
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const maxRetries = 4;
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(url, {
      method: req.method,
      headers: {
        "x-amz-access-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });

    // SP-API rate limiting: exponential backoff on 429.
    if (resp.status === 429 && attempt < maxRetries) {
      await sleep(2 ** attempt * 500);
      continue;
    }

    const text = await resp.text();
    if (!resp.ok) throw new Error(spApiErrorMessage(req, resp, text));
    return text ? JSON.parse(text) : {};
  }
}

/** The API family of a path, e.g. "/orders/v0" — never the IDs, SKUs or ASINs after it. */
export function apiFamily(path: string): string {
  const out: string[] = [];
  const segs = path.split("/").filter(Boolean);
  for (const seg of segs) {
    out.push(seg);
    if (/^v\d+$/.test(seg) || /^\d{4}-\d{2}-\d{2}$/.test(seg)) return "/" + out.join("/");
  }
  // No version segment: fail closed and report only the first segment.
  return "/" + (segs[0] ?? "");
}

/**
 * Error text for a failed SP-API call: status, API family, SP-API error codes and the
 * request id only. The response body and path identifiers are deliberately left out —
 * they can echo order, listing or account data, and thrown errors reach CloudWatch Logs.
 */
export function spApiErrorMessage(req: SpApiRequest, resp: Response, body: string): string {
  let codes = "";
  try {
    const parsed = JSON.parse(body) as { errors?: Array<{ code?: unknown }> };
    codes = (parsed.errors ?? [])
      .map((e) => String(e.code ?? ""))
      .filter((c) => /^[A-Za-z0-9_.-]{1,64}$/.test(c))
      .join(",");
  } catch {
    /* non-JSON body: report no codes */
  }
  const requestId = resp.headers?.get?.("x-amzn-RequestId") ?? "";
  return (
    `SP-API ${req.method} ${apiFamily(req.path)} failed: HTTP ${resp.status}` +
    (codes ? ` (${codes})` : "") +
    (requestId ? ` requestId=${requestId}` : "")
  );
}
