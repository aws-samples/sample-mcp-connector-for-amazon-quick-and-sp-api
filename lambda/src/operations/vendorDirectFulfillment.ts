// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Vendor Direct Fulfillment (DF) suite — only usable if you operate as a DF vendor.
// Reads use typed args; writes accept a `body` pass-through (supply the SP-API body).
import { callSpApi, ClientConfig } from "../spapiClient.js";

const ORD = "/vendor/directFulfillment/orders/2021-12-28";
const SHIP = "/vendor/directFulfillment/shipping/2021-12-28";
const INV = "/vendor/directFulfillment/inventory/v1";
const PAY = "/vendor/directFulfillment/payments/v1";
const TXN = "/vendor/directFulfillment/transactions/2021-12-28";

export const get_df_orders = (cfg: ClientConfig, args: { createdAfter?: string; createdBefore?: string; limit?: number }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `${ORD}/purchaseOrders`,
    query: { createdAfter: args.createdAfter, createdBefore: args.createdBefore, limit: args.limit },
  });
export const get_df_order = (cfg: ClientConfig, args: { purchaseOrderNumber: string }) =>
  callSpApi(cfg, { method: "GET", path: `${ORD}/purchaseOrders/${encodeURIComponent(args.purchaseOrderNumber)}` });
export const submit_df_acknowledgement = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `${ORD}/acknowledgements`, body: args.body });

export const submit_df_shipment_confirmations = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `${SHIP}/shipmentConfirmations`, body: args.body });
export const submit_df_shipment_status_updates = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `${SHIP}/shipmentStatusUpdates`, body: args.body });

export const submit_df_inventory_update = (cfg: ClientConfig, args: { warehouseId: string; body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `${INV}/warehouses/${encodeURIComponent(args.warehouseId)}/items`, body: args.body });

export const submit_df_invoices = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `${PAY}/invoices`, body: args.body });

export const get_df_transaction_status = (cfg: ClientConfig, args: { transactionId: string }) =>
  callSpApi(cfg, { method: "GET", path: `${TXN}/transactions/${encodeURIComponent(args.transactionId)}` });

export const vendorDirectFulfillmentOperations = {
  get_df_orders,
  get_df_order,
  submit_df_acknowledgement,
  submit_df_shipment_confirmations,
  submit_df_shipment_status_updates,
  submit_df_inventory_update,
  submit_df_invoices,
  get_df_transaction_status,
} as const;
