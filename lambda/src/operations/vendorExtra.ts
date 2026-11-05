// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Additional vendor-track operations: transaction status, shipments, invoices,
// demand forecasting (Data Kiosk), and the async Reports runner.
import { callSpApi, ClientConfig } from "../spapiClient.js";
import { runDataKioskQuery, Aggregate, validDate, validAggregate } from "../dataKiosk.js";
import { reportOperations } from "../reports.js";

// ── Transaction status (confirm async submissions) ──
export const get_transaction_status = (cfg: ClientConfig, args: { transactionId: string }) =>
  callSpApi(cfg, { method: "GET", path: `/vendor/transactions/v1/transactions/${encodeURIComponent(args.transactionId)}` });

// ── Shipments (ASN) ──
export const submit_shipment_confirmations = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/vendor/shipping/v1/shipmentConfirmations`, body: args.body });
export const get_shipment_details = (
  cfg: ClientConfig,
  args: { createdAfter?: string; createdBefore?: string; shipmentConfirmedBefore?: string; limit?: number },
) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/vendor/shipping/v1/shipments`,
    query: { createdAfter: args.createdAfter, createdBefore: args.createdBefore, limit: args.limit },
  });

// ── Invoices ──
export const submit_invoices = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/vendor/payments/v1/invoices`, body: args.body });

// ── Demand forecasting (Data Kiosk, manufacturing view) ──
export const get_vendor_forecasting = async (cfg: ClientConfig, args: { startDate: string; endDate: string; aggregateBy?: Aggregate }) => {
  const startDate = validDate(args.startDate, "startDate");
  const endDate = validDate(args.endDate, "endDate");
  const aggregateBy = validAggregate(args.aggregateBy ?? "WEEK");
  const query = `query VendorForecast {
  analytics_vendorAnalytics_2024_09_30 {
    manufacturingView(startDate: "${startDate}" endDate: "${endDate}" aggregateBy: ${aggregateBy} currencyCode: "USD") {
      startDate endDate marketplaceId
      totals { forecasting { startDate endDate weekNumber demand { mean p70 p80 p90 } } }
    }
  }
}`;
  return runDataKioskQuery(cfg, query);
};

export const vendorExtraOperations = {
  get_transaction_status,
  submit_shipment_confirmations,
  get_shipment_details,
  submit_invoices,
  get_vendor_forecasting,
  ...reportOperations,
} as const;
