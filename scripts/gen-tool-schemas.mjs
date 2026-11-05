// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Generates tool-schemas/{seller,vendor}.tools.json for the AgentCore Gateway targets.
// Keeps tool names in sync with the Lambda operation maps. Run: node scripts/gen-tool-schemas.mjs
import { writeFileSync } from "node:fs";

const str = (d) => ({ type: "string", description: d });
const int = (d) => ({ type: "integer", description: d });
const num = (d) => ({ type: "number", description: d });
const bool = (d) => ({ type: "boolean", description: d });
const arrStr = (d) => ({ type: "array", description: d, items: { type: "string" } });
const arrObj = (d) => ({ type: "array", description: d, items: { type: "object" } });
const obj = (d) => ({ type: "object", description: d });

const tool = (name, description, properties = {}, required = []) => {
  const inputSchema = { type: "object", properties };
  if (required.length) inputSchema.required = required;
  return { name, description, inputSchema };
};

const DATE = "ISO-8601 timestamp.";
const YMD = "Date, YYYY-MM-DD.";
const AGG = str("Bucket size: DAY, WEEK, or MONTH.");

const seller = [
  // — orders —
  tool("get_order", "Retrieve a single order by Amazon Order ID (Orders v0). Read-only.", { orderId: str("Amazon Order ID.") }, ["orderId"]),
  tool("get_order_items", "List line items for an order (Orders v0). Read-only.", { orderId: str("Amazon Order ID.") }, ["orderId"]),
  tool("list_orders", "List orders filtered by created/updated date, status, and fulfillment channel (Orders v0). Read-only. Requires createdAfter or lastUpdatedAfter.", { createdAfter: str(DATE), createdBefore: str(DATE), lastUpdatedAfter: str(DATE), orderStatuses: arrStr("e.g. Unshipped, Shipped."), fulfillmentChannels: arrStr("AFN (FBA) or MFN."), maxResultsPerPage: int("1-100.") }),
  tool("confirm_shipment", "WRITE: confirm shipment for an MFN order. Requires confirmation. Supply the SP-API shipmentConfirmation body.", { orderId: str("Amazon Order ID."), body: obj("SP-API ShipmentConfirmation payload (packageDetail, marketplaceId, etc.).") }, ["orderId", "body"]),
  // — catalog —
  tool("search_catalog_items", "Search the Amazon catalog by keywords or identifiers (UPC/EAN/ASIN) (Catalog Items 2022-04-01). Read-only.", { keywords: arrStr("Search keywords."), identifiers: arrStr("Identifier values, e.g. UPCs or ASINs."), identifiersType: str("ASIN, UPC, EAN, GTIN, etc."), includedData: arrStr("summaries, images, salesRanks, attributes."), pageSize: int("1-20.") }),
  tool("get_catalog_item", "Get catalog detail for an ASIN: attributes, images, sales ranks, dimensions (Catalog Items 2022-04-01). Read-only.", { asin: str("ASIN."), includedData: arrStr("summaries, images, salesRanks, attributes, dimensions.") }, ["asin"]),
  // — listings —
  tool("get_listings_item", "Get one of the seller's listings (Listings Items 2021-08-01). Read-only. sellerId defaults to the deployment's SELLER_ID.", { sellerId: str("Selling partner id (optional; injected from config)."), sku: str("Seller SKU."), includedData: arrStr("summaries, attributes, issues, offers, fulfillmentAvailability.") }, ["sku"]),
  tool("search_listings_items", "Search/list the seller's listings (Listings Items 2021-08-01). Read-only.", { sellerId: str("Selling partner id (optional; injected)."), identifiers: arrStr("SKUs to filter by."), pageSize: int("1-20."), includedData: arrStr("summaries, attributes, issues.") }),
  tool("put_listings_item", "WRITE: create or replace a listing (Listings Items 2021-08-01). Requires confirmation. Supply the full SP-API listings body (productType, requirements, attributes).", { sellerId: str("Selling partner id (optional; injected)."), sku: str("Seller SKU."), body: obj("SP-API listings item payload.") }, ["sku", "body"]),
  tool("delete_listings_item", "WRITE: delete a listing (Listings Items 2021-08-01). Requires confirmation.", { sellerId: str("Selling partner id (optional; injected)."), sku: str("Seller SKU.") }, ["sku"]),
  tool("get_listings_restrictions", "Check whether the seller can list a given ASIN and any restrictions (Listings Restrictions 2021-08-01). Read-only.", { sellerId: str("Selling partner id (optional; injected)."), asin: str("ASIN."), conditionType: str("e.g. new_new, used_good.") }, ["asin"]),
  tool("search_product_type_definitions", "Find Amazon product types for listing (Product Type Definitions 2020-09-01). Read-only.", { keywords: arrStr("Keywords."), itemName: str("Product title to infer type.") }),
  tool("get_product_type_definition", "Get the listing schema/requirements for a product type (Product Type Definitions 2020-09-01). Read-only.", { productType: str("e.g. LUGGAGE, SHOES.") }, ["productType"]),
  // — pricing & fees —
  tool("get_competitive_pricing", "Competitive pricing for ASINs or SKUs (Product Pricing v0). Read-only.", { asins: arrStr("ASINs."), skus: arrStr("Seller SKUs.") }),
  tool("get_item_offers", "Current offers for an ASIN, including Buy Box (Product Pricing v0). Read-only.", { asin: str("ASIN."), itemCondition: str("New, Used, etc. Defaults New.") }, ["asin"]),
  tool("get_listing_offers", "Competitive offers for one of the seller's SKUs, including Buy Box (Product Pricing v0). Read-only.", { sellerSku: str("Seller SKU."), itemCondition: str("New, Used, etc. Default New.") }, ["sellerSku"]),
  tool("patch_listing_price", "WRITE: set a new price for a SKU in the US marketplace (Listings Items 2021-08-01). Requires confirmation.", { sku: str("Seller SKU."), price: num("New price (tax-inclusive)."), currency: str("ISO code, default USD.") }, ["sku", "price"]),
  tool("get_my_fees_estimate", "Estimate referral + FBA fees for an ASIN at a given price (Product Fees v0). Read-only.", { asin: str("ASIN."), price: num("Listing price."), currency: str("ISO code, default USD."), isAmazonFulfilled: bool("FBA? default true.") }, ["asin", "price"]),
  // — fulfillment (MCF) —
  tool("create_fulfillment_order", "WRITE: create a Multi-Channel Fulfillment order (FBA Outbound 2020-07-01). Requires confirmation. Supply the SP-API createFulfillmentOrder body.", { body: obj("createFulfillmentOrder payload.") }, ["body"]),
  tool("get_fulfillment_order", "Get an MCF order (FBA Outbound 2020-07-01). Read-only.", { sellerFulfillmentOrderId: str("Your MCF order id.") }, ["sellerFulfillmentOrderId"]),
  tool("list_all_fulfillment_orders", "List MCF orders (FBA Outbound 2020-07-01). Read-only.", { queryStartDate: str(DATE) }),
  tool("cancel_fulfillment_order", "WRITE: cancel an MCF order (FBA Outbound 2020-07-01). Requires confirmation.", { sellerFulfillmentOrderId: str("Your MCF order id.") }, ["sellerFulfillmentOrderId"]),
  tool("get_fulfillment_preview", "Preview MCF options/costs for items + destination (FBA Outbound 2020-07-01). Read-only. Supply the SP-API preview body.", { body: obj("getFulfillmentPreview payload.") }, ["body"]),
  tool("get_package_tracking_details", "Tracking detail for an MCF package (FBA Outbound 2020-07-01). Read-only.", { packageNumber: int("Package number.") }, ["packageNumber"]),
  // — merchant fulfillment (MFN labels) —
  tool("get_eligible_shipment_services", "List eligible carrier services + rates for an MFN shipment (Merchant Fulfillment v0). Read-only. Supply the SP-API body.", { body: obj("getEligibleShipmentServices payload.") }, ["body"]),
  tool("create_shipment", "WRITE: buy an MFN shipping label (Merchant Fulfillment v0). Requires confirmation. Supply the SP-API body.", { body: obj("createShipment payload.") }, ["body"]),
  tool("get_shipment", "Get an MFN shipment/label (Merchant Fulfillment v0). Read-only.", { shipmentId: str("Shipment id.") }, ["shipmentId"]),
  tool("cancel_shipment", "WRITE: cancel an MFN shipment (Merchant Fulfillment v0). Requires confirmation.", { shipmentId: str("Shipment id.") }, ["shipmentId"]),
  // — finances —
  tool("list_financial_events", "List financial events: fees, refunds, adjustments (Finances v0). Read-only.", { postedAfter: str(DATE), postedBefore: str(DATE), maxResultsPerPage: int("1-100.") }),
  tool("list_transactions", "List finance transactions (Finances 2024-06-19). Read-only.", { postedAfter: str(DATE + " Required."), postedBefore: str(DATE), marketplaceId: str("Defaults to US.") }, ["postedAfter"]),
  // — buyer engagement —
  tool("request_review", "WRITE: send the buyer a product-review + seller-feedback request for an order (Solicitations v1). Requires confirmation.", { orderId: str("Amazon Order ID.") }, ["orderId"]),
  tool("get_messaging_actions_for_order", "List the buyer-messaging actions allowed for an order (Messaging v1). Read-only.", { orderId: str("Amazon Order ID.") }, ["orderId"]),
  // — account —
  tool("get_marketplace_participations", "List the marketplaces the seller participates in (Sellers v1). Read-only.", {}),
  // — analytics (Data Kiosk) —
  tool("get_order_metrics", "Aggregated sales volume & amount over a time interval (Sales v1). Read-only. Requires the Inventory and Order Tracking or Product Listing role.", { interval: str("ISO range joined by '--', e.g. 2024-01-01T00:00:00-08:00--2024-01-31T00:00:00-08:00."), granularity: str("Hour, Day, Week, Month, Year, Total. Default Day."), granularityTimeZone: str("e.g. US/Pacific.") }, ["interval"]),
  tool("get_inventory_summaries", "Current FBA inventory levels per SKU (FBA Inventory). Read-only.", { details: bool("Include detailed quantities. Default true.") }),
  tool("get_sales_and_traffic", "Data Kiosk sales & traffic time series: sales, units, sessions, page views, Buy Box %, unit-session %. Async; real data in production only.", { startDate: str(YMD), endDate: str(YMD), aggregateBy: AGG }, ["startDate", "endDate"]),
  tool("get_data_kiosk_result", "Fetch a still-processing Data Kiosk query by queryId. Read-only.", { queryId: str("Data Kiosk queryId.") }, ["queryId"]),
  // — reports —
  tool("run_report", "Run any SP-API report (Reports 2021-06-30) and return a text preview. Async. e.g. GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA, GET_LEDGER_SUMMARY_VIEW_DATA, GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE.", { reportType: str("SP-API report type."), dataStartTime: str(DATE), dataEndTime: str(DATE), marketplaceIds: arrStr("Defaults to US.") }, ["reportType"]),
  tool("get_report_result", "Fetch a still-processing report by reportId (Reports 2021-06-30). Read-only.", { reportId: str("Report id.") }, ["reportId"]),
];

const vendor = [
  // — orders —
  tool("get_purchase_orders", "List vendor (1P) purchase orders by created date (Vendor Orders v1). Read-only.", { createdAfter: str(DATE), createdBefore: str(DATE), limit: int("1-100.") }),
  tool("get_purchase_order", "Get a vendor (1P) purchase order by PO number (Vendor Orders v1). Read-only.", { purchaseOrderNumber: str("PO number.") }, ["purchaseOrderNumber"]),
  tool("get_purchase_orders_status", "Status of vendor (1P) purchase orders (Vendor Orders v1). Read-only.", { createdAfter: str(DATE), createdBefore: str(DATE), limit: int("1-100.") }),
  tool("submit_acknowledgement", "WRITE: acknowledge vendor (1P) purchase orders (Vendor Orders v1). Requires confirmation.", { acknowledgements: arrObj("OrderAcknowledgement objects.") }, ["acknowledgements"]),
  // — transaction status —
  tool("get_transaction_status", "Check the status of a submitted vendor transaction (acknowledgement/shipment/invoice) (Vendor Transaction Status v1). Read-only.", { transactionId: str("Transaction id returned by a submit call.") }, ["transactionId"]),
  // — shipments —
  tool("submit_shipment_confirmations", "WRITE: submit vendor shipment confirmations / ASN (Vendor Shipments v1). Requires confirmation. Supply the SP-API body.", { body: obj("submitShipmentConfirmations payload.") }, ["body"]),
  tool("get_shipment_details", "List vendor shipment details (Vendor Shipments v1). Read-only.", { createdAfter: str(DATE), createdBefore: str(DATE), limit: int("1-100.") }),
  // — invoices —
  tool("submit_invoices", "WRITE: submit vendor invoices (Vendor Invoices v1). Requires confirmation. Supply the SP-API body.", { body: obj("submitInvoices payload.") }, ["body"]),
  // — analytics (Data Kiosk) —
  tool("get_vendor_sales", "Vendor (1P) sales over time from Data Kiosk: net ordered GMS, ordered/shipped units & revenue, ASP. Async; production only.", { startDate: str(YMD), endDate: str(YMD), aggregateBy: AGG }, ["startDate", "endDate"]),
  tool("get_vendor_inventory", "Vendor (1P) inventory health from Data Kiosk: sellable/unsellable on-hand, sell-through, open PO qty, fill/confirmation rates. Async; production only.", { startDate: str(YMD), endDate: str(YMD), aggregateBy: AGG }, ["startDate", "endDate"]),
  tool("get_vendor_traffic", "Vendor (1P) glance views over time from Data Kiosk. Async; production only.", { startDate: str(YMD), endDate: str(YMD), aggregateBy: AGG }, ["startDate", "endDate"]),
  tool("get_vendor_forecasting", "Vendor (1P) demand forecast (mean, p70/p80/p90) from Data Kiosk. Async; production only.", { startDate: str(YMD), endDate: str(YMD), aggregateBy: AGG }, ["startDate", "endDate"]),
  tool("get_data_kiosk_result", "Fetch a still-processing Data Kiosk query by queryId. Read-only.", { queryId: str("Data Kiosk queryId.") }, ["queryId"]),
  // — reports —
  tool("run_report", "Run any SP-API vendor report (Reports 2021-06-30) and return a text preview. Async. e.g. GET_VENDOR_SALES_REPORT, GET_VENDOR_INVENTORY_REPORT, GET_VENDOR_TRAFFIC_REPORT, GET_VENDOR_FORECASTING_REPORT.", { reportType: str("SP-API report type."), dataStartTime: str(DATE), dataEndTime: str(DATE), marketplaceIds: arrStr("Defaults to US.") }, ["reportType"]),
  tool("get_report_result", "Fetch a still-processing report by reportId (Reports 2021-06-30). Read-only.", { reportId: str("Report id.") }, ["reportId"]),
  // — Direct Fulfillment (DF vendor only) —
  tool("get_df_orders", "DF only: list Direct Fulfillment purchase orders (DF Orders 2021-12-28). Read-only.", { createdAfter: str(DATE), createdBefore: str(DATE), limit: int("1-100.") }),
  tool("get_df_order", "DF only: get a Direct Fulfillment purchase order (DF Orders 2021-12-28). Read-only.", { purchaseOrderNumber: str("PO number.") }, ["purchaseOrderNumber"]),
  tool("submit_df_acknowledgement", "DF only WRITE: acknowledge DF purchase orders (DF Orders 2021-12-28). Requires confirmation. Supply the SP-API body.", { body: obj("submitAcknowledgement payload.") }, ["body"]),
  tool("submit_df_shipment_confirmations", "DF only WRITE: confirm DF shipments (DF Shipping 2021-12-28). Requires confirmation. Supply the SP-API body.", { body: obj("submitShipmentConfirmations payload.") }, ["body"]),
  tool("submit_df_shipment_status_updates", "DF only WRITE: update DF shipment status (DF Shipping 2021-12-28). Requires confirmation. Supply the SP-API body.", { body: obj("submitShipmentStatusUpdates payload.") }, ["body"]),
  tool("submit_df_inventory_update", "DF only WRITE: update DF warehouse inventory (DF Inventory v1). Requires confirmation. Supply the SP-API body.", { warehouseId: str("Warehouse id."), body: obj("inventory update payload.") }, ["warehouseId", "body"]),
  tool("submit_df_invoices", "DF only WRITE: submit DF invoices (DF Payments v1). Requires confirmation. Supply the SP-API body.", { body: obj("submitInvoices payload.") }, ["body"]),
  tool("get_df_transaction_status", "DF only: check a DF transaction status (DF Transactions 2021-12-28). Read-only.", { transactionId: str("Transaction id.") }, ["transactionId"]),
];

writeFileSync(new URL("../tool-schemas/seller.tools.json", import.meta.url), JSON.stringify(seller, null, 2) + "\n");
writeFileSync(new URL("../tool-schemas/vendor.tools.json", import.meta.url), JSON.stringify(vendor, null, 2) + "\n");

// Also emit a human-readable tool reference so docs never drift from the schemas.
const table = (arr) => "| Tool | Description |\n|---|---|\n" + arr.map((t) => `| \`${t.name}\` | ${t.description.replace(/\|/g, "\\|")} |`).join("\n") + "\n";
const doc =
  "# Tool reference\n\n_Generated by `scripts/gen-tool-schemas.mjs` — do not edit by hand._\n\n" +
  `## Seller connector (${seller.length} tools)\n\n` + table(seller) + "\n" +
  `## Vendor connector (${vendor.length} tools)\n\n` + table(vendor);
writeFileSync(new URL("../docs/TOOLS.md", import.meta.url), doc);

console.log(`seller: ${seller.length} tools\nvendor: ${vendor.length} tools\n-> docs/TOOLS.md written`);
