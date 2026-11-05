// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Data Kiosk (async GraphQL analytics). Shared runner + seller sales & traffic.
// Flow: createQuery -> poll getQuery until DONE -> getDocument -> fetch+gunzip+parse.
import { gunzipSync } from "node:zlib";
import { callSpApi, ClientConfig, MARKETPLACES } from "./spapiClient.js";

const DK = "/dataKiosk/2023-11-15";
export type Aggregate = "DAY" | "WEEK" | "MONTH";

// Data Kiosk queries are GraphQL text, so caller-supplied values are validated before
// interpolation — anything else could alter the query.
const AGGREGATES: readonly string[] = ["DAY", "WEEK", "MONTH"];

/** Return `value` if it is a real calendar date in YYYY-MM-DD form; throw otherwise. */
export function validDate(value: unknown, field: string): string {
  const s = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ||
      new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw new Error(`${field} must be a date in YYYY-MM-DD form`);
  }
  return s;
}

/** Return `value` if it is DAY, WEEK or MONTH; throw otherwise. */
export function validAggregate(value: unknown): Aggregate {
  if (typeof value !== "string" || !AGGREGATES.includes(value)) {
    throw new Error("aggregateBy must be DAY, WEEK or MONTH");
  }
  return value as Aggregate;
}

/** Seller Sales & Traffic (by date) GraphQL query. */
export function buildSalesAndTrafficQuery(
  startDate: string,
  endDate: string,
  aggregateBy: Aggregate,
  marketplaceIds: string[],
): string {
  startDate = validDate(startDate, "startDate");
  endDate = validDate(endDate, "endDate");
  aggregateBy = validAggregate(aggregateBy);
  for (const id of marketplaceIds) {
    if (!/^[A-Z0-9]{10,14}$/.test(id)) throw new Error("marketplaceIds must be SP-API marketplace IDs");
  }
  const mp = marketplaceIds.map((id) => `"${id}"`).join(", ");
  return `query SalesAndTraffic {
  analytics_salesAndTraffic_2023_11_15 {
    salesAndTrafficByDate(aggregateBy: ${aggregateBy} startDate: "${startDate}" endDate: "${endDate}" marketplaceIds: [${mp}]) {
      startDate endDate marketplaceId
      sales { orderedProductSales { amount currencyCode } unitsOrdered unitsRefunded unitsShipped totalOrderItems }
      traffic { pageViews sessions browserPageViews mobileAppPageViews buyBoxPercentage unitSessionPercentage }
    }
  }
}`;
}

interface QueryStatus {
  queryId: string;
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "FATAL" | "CANCELLED";
  dataDocumentId?: string;
  errorDocumentId?: string;
}

const createQuery = (cfg: ClientConfig, query: string) =>
  callSpApi(cfg, { method: "POST", path: `${DK}/queries`, body: { query } }) as Promise<{ queryId: string }>;
const getQuery = (cfg: ClientConfig, queryId: string) =>
  callSpApi(cfg, { method: "GET", path: `${DK}/queries/${encodeURIComponent(queryId)}` }) as Promise<QueryStatus>;
const getDocumentMeta = (cfg: ClientConfig, documentId: string) =>
  callSpApi(cfg, { method: "GET", path: `${DK}/documents/${encodeURIComponent(documentId)}` }) as Promise<{
    documentId: string;
    documentUrl: string;
  }>;

/** Fetch a Data Kiosk result document; handles gzip and JSON or JSONL payloads. */
async function fetchDocument(documentUrl: string): Promise<unknown> {
  const resp = await fetch(documentUrl);
  const buf = Buffer.from(await resp.arrayBuffer());
  let text: string;
  try {
    text = gunzipSync(buf).toString("utf-8");
  } catch {
    text = buf.toString("utf-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchResult(cfg: ClientConfig, q: QueryStatus) {
  if (!q.dataDocumentId) {
    return { queryId: q.queryId, status: q.processingStatus, note: "Query DONE with no data document (no data for range)." };
  }
  const meta = await getDocumentMeta(cfg, q.dataDocumentId);
  return { queryId: q.queryId, status: q.processingStatus, data: await fetchDocument(meta.documentUrl) };
}

/**
 * Shared runner: create a Data Kiosk query, poll (bounded), and return the parsed rows.
 * If still processing when the wait budget runs out, returns the queryId so the caller
 * can fetch later with getDataKioskResult / the get_data_kiosk_result tool.
 */
export async function runDataKioskQuery(cfg: ClientConfig, query: string, maxWaitSeconds = 90) {
  const { queryId } = await createQuery(cfg, query);
  const maxPolls = Math.max(1, Math.floor(maxWaitSeconds / 5));
  for (let i = 0; i < maxPolls; i++) {
    const q = await getQuery(cfg, queryId);
    if (q.processingStatus === "DONE") return fetchResult(cfg, q);
    if (q.processingStatus === "FATAL" || q.processingStatus === "CANCELLED") {
      return { queryId, status: q.processingStatus, error: q };
    }
    await sleep(5000);
  }
  return { queryId, status: "IN_PROGRESS", note: `Still processing. Call get_data_kiosk_result with queryId "${queryId}".` };
}

/** Check a previously-created Data Kiosk query and return its rows if DONE. */
export async function getDataKioskResult(cfg: ClientConfig, queryId: string) {
  const q = await getQuery(cfg, queryId);
  if (q.processingStatus !== "DONE") return { queryId, status: q.processingStatus };
  return fetchResult(cfg, q);
}

// ── Seller Data Kiosk tools ──
export async function get_sales_and_traffic(
  cfg: ClientConfig,
  args: { startDate: string; endDate: string; aggregateBy?: Aggregate; maxWaitSeconds?: number },
) {
  const query = buildSalesAndTrafficQuery(args.startDate, args.endDate, args.aggregateBy ?? "DAY", [MARKETPLACES.US]);
  return runDataKioskQuery(cfg, query, args.maxWaitSeconds);
}

export async function get_data_kiosk_result(cfg: ClientConfig, args: { queryId: string }) {
  return getDataKioskResult(cfg, args.queryId);
}

export const dataKioskOperations = { get_sales_and_traffic, get_data_kiosk_result } as const;
