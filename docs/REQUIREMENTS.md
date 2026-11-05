# Requirements: roles, buyer data, and sandbox vs production

The tools are only as capable as your SP-API app's authorized **roles** and your environment. This maps what each group needs.

## SP-API roles by tool group

Grant these on your SP-API app in Developer Central, then (re-)authorize the selling partner. A missing role returns `403 Unauthorized` regardless of anything else.

| Tool group | SP-API role (any one listed works) |
|---|---|
| Orders (`get_order`, `get_order_items`, `list_orders`) | Inventory and Order Tracking (most other selling roles also work) |
| `confirm_shipment` | Inventory and Order Tracking |
| Catalog (`search_catalog_items`, `get_catalog_item`) | Product Listing |
| Listings (`get_listings_item`, `search_listings_items`, `put_listings_item`, `delete_listings_item`, `patch_listing_price`, `get_listings_restrictions`, product types) | Product Listing |
| Pricing (`get_listing_offers`, `get_item_offers`, `get_competitive_pricing`) | Pricing, or Product Listing |
| Fees (`get_my_fees_estimate`) | Product Listing, or Pricing |
| `get_order_metrics` (Sales API) | Inventory and Order Tracking, or Product Listing |
| `get_inventory_summaries` (FBA Inventory) | Amazon Fulfillment, or Product Listing |
| Multi-Channel Fulfillment (`create_fulfillment_order`, `get_fulfillment_preview`, …) | Amazon Fulfillment |
| MFN shipping (`get_eligible_shipment_services`, `get_shipment`, `create_shipment`, `cancel_shipment`) | Direct-to-Consumer Shipping (Restricted) — see note below |
| Finances (`list_financial_events`, `list_transactions`) | Finance and Accounting |
| `request_review` (Solicitations API) | Buyer Solicitation |
| `get_messaging_actions_for_order` (Messaging API) | Buyer Communication |
| `get_marketplace_participations` | Selling Partner Insights, or Product Listing |
| Data Kiosk (`get_sales_and_traffic`, `get_vendor_sales/inventory/traffic/forecasting`, `get_data_kiosk_result`) | Brand Analytics |
| Vendor Orders, Invoices, Transaction Status (`get_purchase_orders`, `submit_invoices`, `get_transaction_status`, …) | Amazon Fulfillment, or Inventory and Order Tracking |
| Vendor Shipments (`get_shipment_details`, `submit_shipment_confirmations`, …) | Amazon Fulfillment |
| Direct Fulfillment (`*_df_*`, DF vendors only) | Direct-to-Consumer Shipping (Restricted) — see note below |
| `run_report` / `get_report_result` | Depends on the report type — see [Role Mappings for SP-API Types](https://developer-docs.amazon.com/sp-api/docs/role-mappings-for-types) |

> Roles are from Amazon's [Role Mappings for SP-API Operations](https://developer-docs.amazon.com/sp-api/docs/role-mappings) (North America). Most operations accept any one of several roles, and the mapping changes over time — check that page for the full, current list.

> **Restricted role.** The MFN and Direct Fulfillment tools need the restricted Direct-to-Consumer Shipping role, which Amazon grants only after an additional review. Several of them (`get_shipment`, `create_shipment`, `cancel_shipment`, `get_df_orders`, `get_df_order`) are *restricted operations*: SP-API returns buyer personal data from them only to calls made with a Restricted Data Token, and this release never requests one.

## Buyer personal data

- This release includes **no tools that return restricted buyer data** (buyer names, email addresses, phone numbers, street addresses). SP-API returns those fields only to calls made with a Restricted Data Token, and this sample never requests one.
- Governance still applies: everything you retrieve through SP-API — and route through an AI assistant — is subject to Amazon's [Data Protection Policy](https://developer-docs.amazon.com/sp-api/docs/policies-and-agreements) and your own privacy obligations. Attach each connector only to the Quick spaces and users that need it.

## Sandbox vs production

| | Sandbox (`SP_API_SANDBOX=true`, default) | Production (`SP_API_SANDBOX=false`) |
|---|---|---|
| Host | `sandbox.sellingpartnerapi-*.amazon.com` | `sellingpartnerapi-*.amazon.com` |
| Data | canned; only matches each op's **documented sample params** | real seller/vendor data |
| Writes | canned acceptance, nothing mutated | **mutate real data** — keep human-in-the-loop |
| Data Kiosk / Reports | mostly not meaningful (one canned query) | real async results (poll → `get_*_result`) |
| Credentials | same LWA refresh token as production | same |

To go live: set `SP_API_SANDBOX="false"` in each `.env*`, confirm roles, and re-run `./deploy.sh <persona>`.

## Account Health

There is no dedicated Account Health tool. Sellers can get the Account Health metrics (Order Defect Rate, late-shipment rate, policy violations, Account Health Rating) by calling `run_report` with report type `GET_V2_SELLER_PERFORMANCE_REPORT`, which needs the **Selling Partner Insights** role. `run_report` returns the first 8,000 characters of the report. The report is not available to vendors.
