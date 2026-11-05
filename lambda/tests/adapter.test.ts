// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Secrets Manager so the real auth.ts runs without hitting AWS.
vi.mock("@aws-sdk/client-secrets-manager", () => {
  class SecretsManagerClient {
    async send() {
      return {
        SecretString: JSON.stringify({
          LWA_CLIENT_ID: "cid",
          LWA_CLIENT_SECRET: "csec",
          SP_API_REFRESH_TOKEN: "Atzr|rt",
        }),
      };
    }
  }
  class GetSecretValueCommand {
    constructor(public input: unknown) {}
  }
  return { SecretsManagerClient, GetSecretValueCommand };
});

import { sellerOperations } from "../src/operations/seller.js";
import { vendorOperations } from "../src/operations/vendor.js";
import { buildSalesAndTrafficQuery } from "../src/dataKiosk.js";
import { buildVendorQuery } from "../src/vendorDataKiosk.js";
import type { ClientConfig } from "../src/spapiClient.js";
import sellerSchema from "../../tool-schemas/seller.tools.json";
import vendorSchema from "../../tool-schemas/vendor.tools.json";

const cfg: ClientConfig = { region: "NA", secretId: "test-secret" };
const NA = "https://sellingpartnerapi-na.amazon.com";

function makeResp(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

let calls: Array<{ url: string; init: RequestInit }>;

function stubFetch(spApiResponder?: (url: string) => Response) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://api.amazon.com/auth/o2/token")) {
        return makeResp(200, { access_token: "TESTTOKEN", expires_in: 3600 });
      }
      return spApiResponder ? spApiResponder(url) : makeResp(200, { ok: true });
    }),
  );
}

// Matches both production and sandbox hosts (…sellingpartnerapi-…), excludes the LWA token call.
const spApiCalls = () => calls.filter((c) => c.url.includes("sellingpartnerapi"));

beforeEach(() => stubFetch());

describe("auth + client wiring", () => {
  it("exchanges the refresh token and sends x-amz-access-token", async () => {
    await sellerOperations.get_order(cfg, { orderId: "902-1234567-1234567" });

    const lwa = calls.find((c) => c.url.includes("/auth/o2/token"));
    expect(lwa).toBeTruthy();
    expect(String(lwa!.init.body)).toContain("grant_type=refresh_token");

    const sp = spApiCalls()[0];
    expect(sp.url).toBe(`${NA}/orders/v0/orders/902-1234567-1234567`);
    expect(sp.init.method).toBe("GET");
    expect((sp.init.headers as Record<string, string>)["x-amz-access-token"]).toBe("TESTTOKEN");
  });

  it("retries once on HTTP 429 then succeeds", async () => {
    let n = 0;
    stubFetch(() => (++n === 1 ? makeResp(429, {}) : makeResp(200, { done: true })));
    const res = (await sellerOperations.get_order(cfg, { orderId: "X" })) as { done: boolean };
    expect(res.done).toBe(true);
    expect(spApiCalls().length).toBe(2);
  });
});

describe("seller operations build correct requests", () => {
  it("get_listing_offers adds MarketplaceId + ItemCondition", async () => {
    await sellerOperations.get_listing_offers(cfg, { sellerSku: "ABC-123" });
    const u = new URL(spApiCalls()[0].url);
    expect(u.pathname).toBe("/products/pricing/v0/listings/ABC-123/offers");
    expect(u.searchParams.get("MarketplaceId")).toBe("ATVPDKIKX0DER");
    expect(u.searchParams.get("ItemCondition")).toBe("New");
  });

  it("routes to the sandbox host when cfg.sandbox is set", async () => {
    await sellerOperations.get_order({ ...cfg, sandbox: true }, { orderId: "TEST_CASE_200" });
    expect(spApiCalls()[0].url.startsWith("https://sandbox.sellingpartnerapi-na.amazon.com")).toBe(true);
  });

  it("patch_listing_price PATCHes with the new price in the body", async () => {
    await sellerOperations.patch_listing_price(cfg, { sellerId: "A1SELLER", sku: "ABC-123", price: 19.99 });
    const sp = spApiCalls()[0];
    expect(sp.init.method).toBe("PATCH");
    expect(new URL(sp.url).pathname).toBe("/listings/2021-08-01/items/A1SELLER/ABC-123");
    const body = JSON.parse(String(sp.init.body));
    expect(body.patches[0].value[0].our_price[0].schedule[0].value_with_tax).toBe(19.99);
  });
});

describe("vendor operations build correct requests", () => {
  it("get_purchase_orders passes filters and omits undefined", async () => {
    await vendorOperations.get_purchase_orders(cfg, { createdAfter: "2026-01-01T00:00:00Z", limit: 10 });
    const u = new URL(spApiCalls()[0].url);
    expect(u.pathname).toBe("/vendor/orders/v1/purchaseOrders");
    expect(u.searchParams.get("createdAfter")).toBe("2026-01-01T00:00:00Z");
    expect(u.searchParams.get("limit")).toBe("10");
    expect(u.searchParams.has("createdBefore")).toBe(false);
  });

  it("submit_acknowledgement POSTs the acknowledgements array", async () => {
    await vendorOperations.submit_acknowledgement(cfg, { acknowledgements: [{ purchaseOrderNumber: "PO1" }] });
    const sp = spApiCalls()[0];
    expect(sp.init.method).toBe("POST");
    expect(new URL(sp.url).pathname).toBe("/vendor/orders/v1/acknowledgements");
    expect(JSON.parse(String(sp.init.body)).acknowledgements[0].purchaseOrderNumber).toBe("PO1");
  });
});

describe("dashboard metric operations", () => {
  it("get_inventory_summaries queries FBA inventory for the US marketplace", async () => {
    await sellerOperations.get_inventory_summaries(cfg, {});
    const u = new URL(spApiCalls()[0].url);
    expect(u.pathname).toBe("/fba/inventory/v1/summaries");
    expect(u.searchParams.get("granularityType")).toBe("Marketplace");
    expect(u.searchParams.get("granularityId")).toBe("ATVPDKIKX0DER");
    expect(u.searchParams.get("details")).toBe("true");
  });

  it("get_order_metrics passes the interval and defaults granularity to Day", async () => {
    await sellerOperations.get_order_metrics(cfg, {
      interval: "2024-01-01T00:00:00-08:00--2024-01-31T00:00:00-08:00",
    });
    const u = new URL(spApiCalls()[0].url);
    expect(u.pathname).toBe("/sales/v1/orderMetrics");
    expect(u.searchParams.get("granularity")).toBe("Day");
    expect(u.searchParams.get("marketplaceIds")).toBe("ATVPDKIKX0DER");
  });

  it("buildSalesAndTrafficQuery includes salesAndTrafficByDate, dates, marketplace, and Buy Box", () => {
    const q = buildSalesAndTrafficQuery("2024-01-01", "2024-01-07", "DAY", ["ATVPDKIKX0DER"]);
    expect(q).toContain("salesAndTrafficByDate");
    expect(q).toContain('startDate: "2024-01-01"');
    expect(q).toContain('endDate: "2024-01-07"');
    expect(q).toContain('marketplaceIds: ["ATVPDKIKX0DER"]');
    expect(q).toContain("buyBoxPercentage");
  });

  it("buildVendorQuery targets the vendor analytics schema/view with the right metrics", () => {
    const q = buildVendorQuery("manufacturingView", "2024-01-01", "2024-01-31", "WEEK", ["orders", "shippedOrders"]);
    expect(q).toContain("analytics_vendorAnalytics_2024_09_30");
    expect(q).toContain("manufacturingView");
    expect(q).toContain("netOrderedGMS");
    expect(q).toContain("aggregateBy: WEEK");
  });
});

describe("tool schema ↔ operations parity (prevents Quick listing a tool the Lambda can't run)", () => {
  it("seller schema names exactly match seller operation keys", () => {
    const ops = Object.keys(sellerOperations).sort();
    const names = (sellerSchema as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(ops);
  });
  it("vendor schema names exactly match vendor operation keys", () => {
    const ops = Object.keys(vendorOperations).sort();
    const names = (vendorSchema as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(ops);
  });
  it("no buyer-PII tools are shipped in this release", () => {
    const names = [...(sellerSchema as Array<{ name: string }>), ...(vendorSchema as Array<{ name: string }>)].map((t) => t.name);
    expect(names).not.toContain("get_order_buyer_info");
    expect(names).not.toContain("get_order_address");
  });
});

describe("handler dispatch", () => {
  const ctx = (toolName: string) => ({ clientContext: { custom: { bedrockAgentCoreToolName: toolName } } });

  async function loadHandler(persona: string, env: Record<string, string> = {}) {
    vi.resetModules();
    vi.unstubAllEnvs(); // don't let one test's flags leak into the next
    vi.stubEnv("PERSONA", persona);
    vi.stubEnv("SP_API_SECRET_NAME", "test-secret");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    stubFetch();
    return (await import("../src/handler.js")).handler;
  }

  it("strips the target___ prefix and dispatches to the right op", async () => {
    const handler = await loadHandler("seller");
    await handler({ orderId: "111" }, ctx("spapiseller___get_order"));
    expect(new URL(spApiCalls()[0].url).pathname).toBe("/orders/v0/orders/111");
  });

  it("injects SELLER_ID from env when the agent omits it", async () => {
    const handler = await loadHandler("seller", { SELLER_ID: "ENVSELLER", ENABLE_WRITE_TOOLS: "true" });
    await handler({ sku: "S1", price: 5 }, ctx("spapiseller___patch_listing_price"));
    expect(new URL(spApiCalls()[0].url).pathname).toBe("/listings/2021-08-01/items/ENVSELLER/S1");
  });

  it("throws on an unknown tool", async () => {
    const handler = await loadHandler("vendor");
    await expect(handler({}, ctx("spapivendor___nope"))).rejects.toThrow(/Unknown tool 'nope'/);
  });

  it("does not resolve inherited object keys as tools", async () => {
    const handler = await loadHandler("seller");
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      await expect(handler({}, ctx(`spapiseller___${name}`))).rejects.toThrow(/Unknown tool/);
    }
    expect(spApiCalls()).toHaveLength(0);
  });

  it("refuses write tools by default (read-only deployment)", async () => {
    const handler = await loadHandler("seller", { SELLER_ID: "S" });
    await expect(handler({ sku: "S1", price: 5 }, ctx("spapiseller___patch_listing_price"))).rejects.toThrow(/Unknown tool/);
    const vendor = await loadHandler("vendor");
    await expect(vendor({ acknowledgements: [] }, ctx("spapivendor___submit_acknowledgement"))).rejects.toThrow(/Unknown tool/);
    expect(spApiCalls()).toHaveLength(0);
  });

  it("still serves read tools when write tools are disabled", async () => {
    const handler = await loadHandler("seller");
    await handler({ orderId: "111" }, ctx("spapiseller___get_order"));
    expect(spApiCalls()).toHaveLength(1);
  });
});

describe("Data Kiosk input validation (values are interpolated into GraphQL)", () => {
  const injected = '2024-01-01" marketplaceIds: ["X"]) { __schema { types { name } } } #';

  it("accepts real YYYY-MM-DD dates and the DAY/WEEK/MONTH enum", () => {
    expect(() => buildSalesAndTrafficQuery("2024-02-29", "2024-03-31", "MONTH", ["ATVPDKIKX0DER"])).not.toThrow();
    expect(() => buildVendorQuery("sourcingView", "2024-01-01", "2024-01-31", "DAY", ["sourcing"])).not.toThrow();
  });

  it("rejects malformed or injected dates", () => {
    for (const bad of [injected, "2024-1-01", "2024-13-01", "2023-02-29", "", "20240101"]) {
      expect(() => buildSalesAndTrafficQuery(bad, "2024-01-07", "DAY", ["ATVPDKIKX0DER"])).toThrow(/YYYY-MM-DD/);
      expect(() => buildVendorQuery("manufacturingView", "2024-01-01", bad, "WEEK", ["orders"])).toThrow(/YYYY-MM-DD/);
    }
  });

  it("rejects marketplace IDs that are not SP-API marketplace IDs", () => {
    expect(() => buildSalesAndTrafficQuery("2024-01-01", "2024-01-07", "DAY", ['ATVPDKIKX0DER"] ) { x } #'])).toThrow(/marketplace IDs/);
    expect(() => buildSalesAndTrafficQuery("2024-01-01", "2024-01-07", "DAY", ["ATVPDKIKX0DER", "A2EUQ1WTGCTBG2"])).not.toThrow();
  });

  it("rejects an aggregateBy outside the enum", () => {
    const bad = "DAY startDate: \"1999-01-01\"" as unknown as "DAY";
    expect(() => buildSalesAndTrafficQuery("2024-01-01", "2024-01-07", bad, ["ATVPDKIKX0DER"])).toThrow(/DAY, WEEK or MONTH/);
    expect(() => buildVendorQuery("manufacturingView", "2024-01-01", "2024-01-31", bad, ["orders"])).toThrow(/DAY, WEEK or MONTH/);
  });

  it("get_vendor_forecasting validates before calling SP-API", async () => {
    stubFetch();
    await expect(
      vendorOperations.get_vendor_forecasting(cfg, { startDate: injected, endDate: "2024-01-31" }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(spApiCalls()).toHaveLength(0);
  });
});

describe("write-tool list stays in sync with the schemas", () => {
  it("WRITE_TOOLS equals every schema tool whose description starts with WRITE", async () => {
    const { WRITE_TOOLS } = await import("../src/writeTools.js");
    const marked = [...(sellerSchema as Array<{ name: string; description: string }>), ...(vendorSchema as Array<{ name: string; description: string }>)]
      .filter((t) => /^(DF only )?WRITE/.test(t.description))
      .map((t) => t.name)
      .sort();
    expect([...WRITE_TOOLS].sort()).toEqual(marked);
  });
});

describe("error messages never carry response bodies or path identifiers", () => {
  it("reports status, API family and SP-API error codes only", async () => {
    stubFetch(() =>
      makeResp(400, { errors: [{ code: "InvalidInput", message: "Buyer jane@example.com SKU SECRET-SKU-123" }] }),
    );
    const err = await sellerOperations.get_order(cfg, { orderId: "902-SENSITIVE-ID" }).catch((e: Error) => e);
    expect(String(err)).toMatch(/HTTP 400/);
    expect(String(err)).toMatch(/\(InvalidInput\)/);
    expect(String(err)).toMatch(/\/orders\/v0/);
    expect(String(err)).not.toMatch(/jane@example\.com|SECRET-SKU-123|902-SENSITIVE-ID/);
  });

  it("does not leak a non-JSON error body", async () => {
    stubFetch(() => ({ ok: false, status: 503, text: async () => "<html>internal page with data</html>" }) as Response);
    const err = await sellerOperations.get_order(cfg, { orderId: "1" }).catch((e: Error) => e);
    expect(String(err)).toMatch(/HTTP 503/);
    expect(String(err)).not.toMatch(/internal page|<html>/);
  });

  it("reports only the OAuth error code when Login with Amazon rejects the refresh token", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeResp(400, { error: "invalid_grant", error_description: "token Atzr|SECRETVALUE revoked" })),
    );
    const { sellerOperations: fresh } = await import("../src/operations/seller.js");
    const err = await fresh.get_order(cfg, { orderId: "1" }).catch((e: Error) => e);
    expect(String(err)).toMatch(/LWA token exchange failed: HTTP 400 \(invalid_grant\)/);
    expect(String(err)).not.toMatch(/SECRETVALUE|revoked/);
  });

  it("apiFamily keeps the API and version, drops everything after", async () => {
    const { apiFamily } = await import("../src/spapiClient.js");
    expect(apiFamily("/orders/v0/orders/902-1/orderItems")).toBe("/orders/v0");
    expect(apiFamily("/listings/2021-08-01/items/SELLER/MY-SKU")).toBe("/listings/2021-08-01");
    expect(apiFamily("/products/pricing/v0/items/B00ASIN/offers")).toBe("/products/pricing/v0");
    expect(apiFamily("/fba/outbound/2020-07-01/fulfillmentOrders/X")).toBe("/fba/outbound/2020-07-01");
    expect(apiFamily("/unversioned/ORDER-123/items")).toBe("/unversioned"); // fails closed
  });

  it("a malformed secret value is never quoted into the error", async () => {
    vi.resetModules();
    vi.doMock("@aws-sdk/client-secrets-manager", () => ({
      SecretsManagerClient: class { async send() { return { SecretString: '{"LWA_CLIENT_SECRET":"SUPERSECRETVALUE' }; } },
      GetSecretValueCommand: class { constructor(public input: unknown) {} },
    }));
    const { loadCredentials } = await import("../src/auth.js");
    const err = await loadCredentials("bad-secret").catch((e: Error) => e);
    expect(String(err)).toMatch(/is not valid JSON/);
    expect(String(err)).not.toMatch(/SUPERSECRET/);
    vi.doUnmock("@aws-sdk/client-secrets-manager");
  });
});

describe("request paths cannot be redirected by tool arguments", () => {
  it("rejects '.' and '..' path arguments before fetching a token or calling SP-API", async () => {
    for (const orderId of ["..", "."]) {
      const err = await sellerOperations.get_order(cfg, { orderId }).catch((e: Error) => e);
      expect(String(err)).toMatch(/not a valid path segment/);
    }
    const err = await sellerOperations.get_catalog_item(cfg, { asin: ".." }).catch((e: Error) => e);
    expect(String(err)).toMatch(/not a valid path segment/);
    expect(calls).toHaveLength(0); // no LWA exchange, no SP-API call
  });

  it("still accepts ids that merely contain dots", async () => {
    await sellerOperations.get_order(cfg, { orderId: "1.2..3" });
    expect(new URL(spApiCalls()[0].url).pathname).toBe("/orders/v0/orders/1.2..3");
  });
});
