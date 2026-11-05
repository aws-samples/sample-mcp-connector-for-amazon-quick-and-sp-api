// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Seller-track SP-API operations (NA). Each maps a tool name → SP-API call.
import { callSpApi, ClientConfig, MARKETPLACES } from "../spapiClient.js";
import { dataKioskOperations } from "../dataKiosk.js";
import { sellerExtraOperations } from "./sellerExtra.js";

export async function get_order(cfg: ClientConfig, args: { orderId: string }) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/orders/v0/orders/${encodeURIComponent(args.orderId)}`,
  });
}

export async function get_order_items(cfg: ClientConfig, args: { orderId: string }) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/orders/v0/orders/${encodeURIComponent(args.orderId)}/orderItems`,
  });
}

export async function get_listing_offers(
  cfg: ClientConfig,
  args: { sellerSku: string; itemCondition?: string },
) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/products/pricing/v0/listings/${encodeURIComponent(args.sellerSku)}/offers`,
    query: { MarketplaceId: MARKETPLACES.US, ItemCondition: args.itemCondition ?? "New" },
  });
}

/**
 * WRITE — set a new price on a listing via JSON Patch.
 * NOTE: the exact `purchasable_offer` attribute shape depends on the product type;
 * this is the common template and may need per-product-type adjustment.
 */
export async function patch_listing_price(
  cfg: ClientConfig,
  args: { sellerId: string; sku: string; price: number; currency?: string },
) {
  return callSpApi(cfg, {
    method: "PATCH",
    path: `/listings/2021-08-01/items/${encodeURIComponent(args.sellerId)}/${encodeURIComponent(args.sku)}`,
    query: { marketplaceIds: MARKETPLACES.US },
    body: {
      productType: "PRODUCT",
      patches: [
        {
          op: "replace",
          path: "/attributes/purchasable_offer",
          value: [
            {
              marketplace_id: MARKETPLACES.US,
              currency: args.currency ?? "USD",
              our_price: [{ schedule: [{ value_with_tax: args.price }] }],
            },
          ],
        },
      ],
    },
  });
}

// ── Aggregate / dashboard metrics ──

/** Sales volume/amount over time (Sales API). Requires the Inventory and Order Tracking or Product Listing role. */
export async function get_order_metrics(
  cfg: ClientConfig,
  args: { interval: string; granularity?: string; granularityTimeZone?: string },
) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/sales/v1/orderMetrics`,
    query: {
      marketplaceIds: MARKETPLACES.US,
      interval: args.interval,
      granularity: args.granularity ?? "Day",
      granularityTimeZone: args.granularityTimeZone ?? "US/Pacific",
    },
  });
}

/** Current FBA inventory levels/health for the marketplace (FBA Inventory API). */
export async function get_inventory_summaries(cfg: ClientConfig, args: { details?: boolean }) {
  return callSpApi(cfg, {
    method: "GET",
    path: `/fba/inventory/v1/summaries`,
    query: {
      granularityType: "Marketplace",
      granularityId: MARKETPLACES.US,
      marketplaceIds: MARKETPLACES.US,
      details: String(args.details ?? true),
    },
  });
}

export const sellerOperations = {
  get_order,
  get_order_items,
  get_listing_offers,
  patch_listing_price,
  get_order_metrics,
  get_inventory_summaries,
  ...dataKioskOperations,
  ...sellerExtraOperations,
} as const;
