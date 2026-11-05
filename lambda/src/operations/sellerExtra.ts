// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Additional seller-track SP-API operations (NA). Reads use typed args; complex writes
// accept a `body` pass-through (supply the SP-API request body). Reports are async.
import { callSpApi, ClientConfig, MARKETPLACES } from "../spapiClient.js";
import { reportOperations } from "../reports.js";

const US = MARKETPLACES.US;
const csv = (v?: string[] | string) => (Array.isArray(v) ? v.join(",") : v);

// ── Orders ──
export const list_orders = (
  cfg: ClientConfig,
  args: { createdAfter?: string; createdBefore?: string; lastUpdatedAfter?: string; orderStatuses?: string[]; fulfillmentChannels?: string[]; maxResultsPerPage?: number },
) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/orders/v0/orders`,
    query: {
      MarketplaceIds: US,
      CreatedAfter: args.createdAfter,
      CreatedBefore: args.createdBefore,
      LastUpdatedAfter: args.lastUpdatedAfter,
      OrderStatuses: csv(args.orderStatuses),
      FulfillmentChannels: csv(args.fulfillmentChannels),
      MaxResultsPerPage: args.maxResultsPerPage,
    },
  });

export const confirm_shipment = (cfg: ClientConfig, args: { orderId: string; body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/orders/v0/orders/${encodeURIComponent(args.orderId)}/shipmentConfirmation`, body: args.body });

// ── Catalog ──
export const search_catalog_items = (
  cfg: ClientConfig,
  args: { keywords?: string[]; identifiers?: string[]; identifiersType?: string; includedData?: string[]; pageSize?: number },
) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/catalog/2022-04-01/items`,
    query: {
      marketplaceIds: US,
      keywords: csv(args.keywords),
      identifiers: csv(args.identifiers),
      identifiersType: args.identifiersType,
      includedData: csv(args.includedData) ?? "summaries",
      pageSize: args.pageSize,
    },
  });

export const get_catalog_item = (cfg: ClientConfig, args: { asin: string; includedData?: string[] }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/catalog/2022-04-01/items/${encodeURIComponent(args.asin)}`,
    query: { marketplaceIds: US, includedData: csv(args.includedData) ?? "summaries,images,salesRanks" },
  });

// ── Listings ──
export const get_listings_item = (cfg: ClientConfig, args: { sellerId: string; sku: string; includedData?: string[] }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/listings/2021-08-01/items/${encodeURIComponent(args.sellerId)}/${encodeURIComponent(args.sku)}`,
    query: { marketplaceIds: US, includedData: csv(args.includedData) ?? "summaries,attributes,issues,offers" },
  });

export const search_listings_items = (cfg: ClientConfig, args: { sellerId: string; identifiers?: string[]; pageSize?: number; includedData?: string[] }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/listings/2021-08-01/items/${encodeURIComponent(args.sellerId)}`,
    query: {
      marketplaceIds: US,
      identifiers: csv(args.identifiers),
      identifiersType: args.identifiers ? "SKU" : undefined,
      pageSize: args.pageSize,
      includedData: csv(args.includedData) ?? "summaries",
    },
  });

export const put_listings_item = (cfg: ClientConfig, args: { sellerId: string; sku: string; body: unknown }) =>
  callSpApi(cfg, {
    method: "PUT",
    path: `/listings/2021-08-01/items/${encodeURIComponent(args.sellerId)}/${encodeURIComponent(args.sku)}`,
    query: { marketplaceIds: US },
    body: args.body,
  });

export const delete_listings_item = (cfg: ClientConfig, args: { sellerId: string; sku: string }) =>
  callSpApi(cfg, {
    method: "DELETE",
    path: `/listings/2021-08-01/items/${encodeURIComponent(args.sellerId)}/${encodeURIComponent(args.sku)}`,
    query: { marketplaceIds: US },
  });

export const get_listings_restrictions = (cfg: ClientConfig, args: { sellerId: string; asin: string; conditionType?: string }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/listings/2021-08-01/restrictions`,
    query: { asin: args.asin, sellerId: args.sellerId, marketplaceIds: US, conditionType: args.conditionType },
  });

export const search_product_type_definitions = (cfg: ClientConfig, args: { keywords?: string[]; itemName?: string }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/definitions/2020-09-01/productTypes`,
    query: { marketplaceIds: US, keywords: csv(args.keywords), itemName: args.itemName },
  });

export const get_product_type_definition = (cfg: ClientConfig, args: { productType: string }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/definitions/2020-09-01/productTypes/${encodeURIComponent(args.productType)}`,
    query: { marketplaceIds: US, requirements: "LISTING" },
  });

// ── Pricing & fees ──
export const get_competitive_pricing = (cfg: ClientConfig, args: { asins?: string[]; skus?: string[] }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/products/pricing/v0/competitivePrice`,
    query: {
      MarketplaceId: US,
      ItemType: args.skus ? "Sku" : "Asin",
      Asins: csv(args.asins),
      Skus: csv(args.skus),
    },
  });

export const get_item_offers = (cfg: ClientConfig, args: { asin: string; itemCondition?: string }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/products/pricing/v0/items/${encodeURIComponent(args.asin)}/offers`,
    query: { MarketplaceId: US, ItemCondition: args.itemCondition ?? "New" },
  });

export const get_my_fees_estimate = (
  cfg: ClientConfig,
  args: { asin: string; price: number; currency?: string; isAmazonFulfilled?: boolean },
) =>
  callSpApi(cfg, {
    method: "POST",
    path: `/products/fees/v0/items/${encodeURIComponent(args.asin)}/feesEstimate`,
    body: {
      FeesEstimateRequest: {
        MarketplaceId: US,
        IsAmazonFulfilled: args.isAmazonFulfilled ?? true,
        Identifier: `req-${args.asin}`,
        PriceToEstimateFees: { ListingPrice: { CurrencyCode: args.currency ?? "USD", Amount: args.price } },
      },
    },
  });

// ── Fulfillment (Multi-Channel Fulfillment) ──
export const create_fulfillment_order = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/fba/outbound/2020-07-01/fulfillmentOrders`, body: args.body });
export const get_fulfillment_order = (cfg: ClientConfig, args: { sellerFulfillmentOrderId: string }) =>
  callSpApi(cfg, { method: "GET", path: `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(args.sellerFulfillmentOrderId)}` });
export const list_all_fulfillment_orders = (cfg: ClientConfig, args: { queryStartDate?: string }) =>
  callSpApi(cfg, { method: "GET", path: `/fba/outbound/2020-07-01/fulfillmentOrders`, query: { queryStartDate: args.queryStartDate } });
export const cancel_fulfillment_order = (cfg: ClientConfig, args: { sellerFulfillmentOrderId: string }) =>
  callSpApi(cfg, { method: "PUT", path: `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(args.sellerFulfillmentOrderId)}/cancel` });
export const get_fulfillment_preview = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/fba/outbound/2020-07-01/fulfillmentOrders/preview`, body: args.body });
export const get_package_tracking_details = (cfg: ClientConfig, args: { packageNumber: number }) =>
  callSpApi(cfg, { method: "GET", path: `/fba/outbound/2020-07-01/tracking`, query: { packageNumber: args.packageNumber } });

// ── Merchant Fulfillment (MFN shipping labels) ──
export const get_eligible_shipment_services = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/mfn/v0/eligibleShippingServices`, body: args.body });
export const create_shipment = (cfg: ClientConfig, args: { body: unknown }) =>
  callSpApi(cfg, { method: "POST", path: `/mfn/v0/shipments`, body: args.body });
export const get_shipment = (cfg: ClientConfig, args: { shipmentId: string }) =>
  callSpApi(cfg, { method: "GET", path: `/mfn/v0/shipments/${encodeURIComponent(args.shipmentId)}` });
export const cancel_shipment = (cfg: ClientConfig, args: { shipmentId: string }) =>
  callSpApi(cfg, { method: "DELETE", path: `/mfn/v0/shipments/${encodeURIComponent(args.shipmentId)}` });

// ── Finances ──
export const list_financial_events = (cfg: ClientConfig, args: { postedAfter?: string; postedBefore?: string; maxResultsPerPage?: number }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/finances/v0/financialEvents`,
    query: { PostedAfter: args.postedAfter, PostedBefore: args.postedBefore, MaxResultsPerPage: args.maxResultsPerPage },
  });
export const list_transactions = (cfg: ClientConfig, args: { postedAfter: string; postedBefore?: string; marketplaceId?: string }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/finances/2024-06-19/transactions`,
    query: { postedAfter: args.postedAfter, postedBefore: args.postedBefore, marketplaceId: args.marketplaceId ?? US },
  });

// ── Buyer engagement ──
export const request_review = (cfg: ClientConfig, args: { orderId: string }) =>
  callSpApi(cfg, {
    method: "POST",
    path: `/solicitations/v1/orders/${encodeURIComponent(args.orderId)}/solicitations/productReviewAndSellerFeedback`,
    query: { marketplaceIds: US },
  });
export const get_messaging_actions_for_order = (cfg: ClientConfig, args: { orderId: string }) =>
  callSpApi(cfg, {
    method: "GET",
    path: `/messaging/v1/orders/${encodeURIComponent(args.orderId)}`,
    query: { marketplaceIds: US },
  });

// ── Account ──
export const get_marketplace_participations = (cfg: ClientConfig, _args: Record<string, never>) =>
  callSpApi(cfg, { method: "GET", path: `/sellers/v1/marketplaceParticipations` });

export const sellerExtraOperations = {
  list_orders,
  confirm_shipment,
  search_catalog_items,
  get_catalog_item,
  get_listings_item,
  search_listings_items,
  put_listings_item,
  delete_listings_item,
  get_listings_restrictions,
  search_product_type_definitions,
  get_product_type_definition,
  get_competitive_pricing,
  get_item_offers,
  get_my_fees_estimate,
  create_fulfillment_order,
  get_fulfillment_order,
  list_all_fulfillment_orders,
  cancel_fulfillment_order,
  get_fulfillment_preview,
  get_package_tracking_details,
  get_eligible_shipment_services,
  create_shipment,
  get_shipment,
  cancel_shipment,
  list_financial_events,
  list_transactions,
  request_review,
  get_messaging_actions_for_order,
  get_marketplace_participations,
  ...reportOperations,
} as const;
