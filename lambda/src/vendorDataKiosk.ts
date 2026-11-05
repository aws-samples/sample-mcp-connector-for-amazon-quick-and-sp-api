// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Vendor (1P) Data Kiosk analytics — schema analytics_vendorAnalytics_2024_09_30.
// Purpose-built tools that pick the right view + metric groups internally, so the
// agent just asks for sales / inventory / traffic over a date range.
import { ClientConfig } from "./spapiClient.js";
import { runDataKioskQuery, getDataKioskResult, Aggregate, validDate, validAggregate } from "./dataKiosk.js";

const SCHEMA = "analytics_vendorAnalytics_2024_09_30";
type View = "sourcingView" | "manufacturingView";
type MetricGroup = "orders" | "shippedOrders" | "productAvailability" | "sourcing" | "traffic";

function metricBlock(group: MetricGroup): string {
  switch (group) {
    case "orders":
      return `orders { netOrderedGMS { amount currencyCode } orderedUnitsWithRevenue { units value { amount currencyCode } } unfilledOrderedUnits }`;
    case "shippedOrders":
      return `shippedOrders { shippedUnitsWithRevenue { units value { amount currencyCode } } averageSellingPrice { amount currencyCode } }`;
    case "productAvailability":
      return `productAvailability { sellableOnHandInventory { units value { amount currencyCode } } unsellableOnHandInventory { units value { amount currencyCode } } sellThroughRate }`;
    case "sourcing":
      return `sourcing { netReceived { units value { amount currencyCode } } confirmedUnits openPurchaseOrderQuantity receivedFillRate vendorConfirmationRate }`;
    case "traffic":
      return `traffic { glanceViews }`;
  }
}

export function buildVendorQuery(
  view: View,
  startDate: string,
  endDate: string,
  aggregateBy: Aggregate,
  groups: MetricGroup[],
): string {
  startDate = validDate(startDate, "startDate");
  endDate = validDate(endDate, "endDate");
  aggregateBy = validAggregate(aggregateBy);
  const totals = groups.map(metricBlock).join("\n        ");
  return `query VendorAnalytics {
  ${SCHEMA} {
    ${view}(startDate: "${startDate}" endDate: "${endDate}" aggregateBy: ${aggregateBy} currencyCode: "USD") {
      startDate endDate marketplaceId
      totals { ${totals} }
    }
  }
}`;
}

/** Vendor sales: net ordered GMS, ordered/shipped units & revenue, ASP over time (manufacturing view). */
export async function get_vendor_sales(
  cfg: ClientConfig,
  args: { startDate: string; endDate: string; aggregateBy?: Aggregate },
) {
  return runDataKioskQuery(
    cfg,
    buildVendorQuery("manufacturingView", args.startDate, args.endDate, args.aggregateBy ?? "WEEK", ["orders", "shippedOrders"]),
  );
}

/** Vendor inventory health: sellable/unsellable on-hand, sell-through, open PO qty, fill/confirmation rates (sourcing view). */
export async function get_vendor_inventory(
  cfg: ClientConfig,
  args: { startDate: string; endDate: string; aggregateBy?: Aggregate },
) {
  return runDataKioskQuery(
    cfg,
    buildVendorQuery("sourcingView", args.startDate, args.endDate, args.aggregateBy ?? "WEEK", ["productAvailability", "sourcing"]),
  );
}

/** Vendor traffic: glance views over time (manufacturing view). */
export async function get_vendor_traffic(
  cfg: ClientConfig,
  args: { startDate: string; endDate: string; aggregateBy?: Aggregate },
) {
  return runDataKioskQuery(
    cfg,
    buildVendorQuery("manufacturingView", args.startDate, args.endDate, args.aggregateBy ?? "WEEK", ["traffic"]),
  );
}

export async function get_data_kiosk_result(cfg: ClientConfig, args: { queryId: string }) {
  return getDataKioskResult(cfg, args.queryId);
}

export const vendorDataKioskOperations = {
  get_vendor_sales,
  get_vendor_inventory,
  get_vendor_traffic,
  get_data_kiosk_result,
} as const;
