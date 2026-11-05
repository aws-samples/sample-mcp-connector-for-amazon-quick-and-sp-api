// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Tools that change data in the selling partner's account. They are only dispatchable
// when ENABLE_WRITE_TOOLS=true, so a default deployment is read-only. A unit test keeps
// this list in sync with the tool schemas (every description starting with "WRITE").
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  // seller
  "confirm_shipment",
  "put_listings_item",
  "delete_listings_item",
  "patch_listing_price",
  "create_fulfillment_order",
  "cancel_fulfillment_order",
  "create_shipment",
  "cancel_shipment",
  "request_review",
  // vendor
  "submit_acknowledgement",
  "submit_shipment_confirmations",
  "submit_invoices",
  "submit_df_acknowledgement",
  "submit_df_shipment_confirmations",
  "submit_df_shipment_status_updates",
  "submit_df_inventory_update",
  "submit_df_invoices",
]);
