// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Reports API (async) — shared by seller and vendor. Create a report, poll, fetch the
// document (gzip-aware), and return a capped text preview so MCP responses stay small.
import { gunzipSync } from "node:zlib";
import { callSpApi, ClientConfig, MARKETPLACES } from "./spapiClient.js";

const REP = "/reports/2021-06-30";
const MAX_CHARS = 8000; // cap the returned report text

interface ReportStatus {
  reportId: string;
  processingStatus: "IN_QUEUE" | "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL";
  reportDocumentId?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchReportDocument(cfg: ClientConfig, reportDocumentId: string) {
  const doc = (await callSpApi(cfg, {
    method: "GET",
    path: `${REP}/documents/${encodeURIComponent(reportDocumentId)}`,
  })) as { url: string; compressionAlgorithm?: string };
  const resp = await fetch(doc.url);
  const raw = Buffer.from(await resp.arrayBuffer());
  const text = doc.compressionAlgorithm === "GZIP" ? gunzipSync(raw).toString("utf-8") : raw.toString("utf-8");
  const truncated = text.length > MAX_CHARS;
  return { reportDocumentId, truncated, contentPreview: truncated ? text.slice(0, MAX_CHARS) : text };
}

/**
 * Create a report, poll until DONE (bounded), and return a preview of the document.
 * reportType examples: GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL,
 * GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA, GET_FBA_INVENTORY_PLANNING_DATA,
 * GET_LEDGER_SUMMARY_VIEW_DATA, GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE (browse the SP-API report type list).
 */
export async function run_report(
  cfg: ClientConfig,
  args: { reportType: string; dataStartTime?: string; dataEndTime?: string; marketplaceIds?: string[]; maxWaitSeconds?: number },
) {
  const body = {
    reportType: args.reportType,
    marketplaceIds: args.marketplaceIds ?? [MARKETPLACES.US],
    ...(args.dataStartTime ? { dataStartTime: args.dataStartTime } : {}),
    ...(args.dataEndTime ? { dataEndTime: args.dataEndTime } : {}),
  };
  const { reportId } = (await callSpApi(cfg, { method: "POST", path: `${REP}/reports`, body })) as { reportId: string };

  const maxPolls = Math.max(1, Math.floor((args.maxWaitSeconds ?? 90) / 5));
  for (let i = 0; i < maxPolls; i++) {
    const rep = (await callSpApi(cfg, { method: "GET", path: `${REP}/reports/${encodeURIComponent(reportId)}` })) as ReportStatus;
    if (rep.processingStatus === "DONE" && rep.reportDocumentId) {
      return { reportId, status: "DONE", ...(await fetchReportDocument(cfg, rep.reportDocumentId)) };
    }
    if (rep.processingStatus === "CANCELLED" || rep.processingStatus === "FATAL") {
      return { reportId, status: rep.processingStatus, error: rep };
    }
    await sleep(5000);
  }
  return { reportId, status: "IN_PROGRESS", note: `Still processing. Call get_report_result with reportId "${reportId}".` };
}

/** Fetch a previously-created report if it is DONE. */
export async function get_report_result(cfg: ClientConfig, args: { reportId: string }) {
  const rep = (await callSpApi(cfg, { method: "GET", path: `${REP}/reports/${encodeURIComponent(args.reportId)}` })) as ReportStatus;
  if (rep.processingStatus !== "DONE" || !rep.reportDocumentId) {
    return { reportId: args.reportId, status: rep.processingStatus };
  }
  return { reportId: args.reportId, status: "DONE", ...(await fetchReportDocument(cfg, rep.reportDocumentId)) };
}

export const reportOperations = { run_report, get_report_result } as const;
