// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Vendor-track SP-API operations (NA) — Vendor Retail Procurement (1P) Orders v1
// plus vendor analytics (Data Kiosk) for dashboards.
import { callSpApi, ClientConfig } from "../spapiClient.js";
import { vendorDataKioskOperations } from "../vendorDataKiosk.js";
import { vendorExtraOperations } from "./vendorExtra.js";
import { vendorDirectFulfillmentOperations } from "./vendorDirectFulfillment.js";

export async function get_purchase_orders(
  cfg: ClientConfig,
  args: { createdAfter?: string; createdBefore?: string; limit?: number },
) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/vendor/orders/v1/purchaseOrders`,
    query: { createdAfter: args.createdAfter, createdBefore: args.createdBefore, limit: args.limit },
  });
}

export async function get_purchase_order(
  cfg: ClientConfig,
  args: { purchaseOrderNumber: string },
) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/vendor/orders/v1/purchaseOrders/${encodeURIComponent(args.purchaseOrderNumber)}`,
  });
}

export async function get_purchase_orders_status(
  cfg: ClientConfig,
  args: { createdAfter?: string; createdBefore?: string; limit?: number },
) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/vendor/orders/v1/purchaseOrdersStatus`,
    query: { createdAfter: args.createdAfter, createdBefore: args.createdBefore, limit: args.limit },
  });
}

/**
 * WRITE — acknowledge one or more purchase orders.
 * `acknowledgements` follows the Vendor Orders v1 SubmitAcknowledgementRequest shape.
 */
export async function submit_acknowledgement(
  cfg: ClientConfig,
  args: { acknowledgements: unknown[] },
) {
  return callSpApi(cfg, {
    method: "POST",
    path: `/vendor/orders/v1/acknowledgements`,
    body: { acknowledgements: args.acknowledgements },
  });
}

export const vendorOperations = {
  get_purchase_orders,
  get_purchase_order,
  get_purchase_orders_status,
  submit_acknowledgement,
  ...vendorDataKioskOperations,
  ...vendorExtraOperations,
  ...vendorDirectFulfillmentOperations,
} as const;
