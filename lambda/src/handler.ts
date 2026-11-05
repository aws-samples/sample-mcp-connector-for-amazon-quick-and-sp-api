// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// AgentCore Gateway Lambda-target entrypoint.
//
// Contract (per AgentCore docs):
//   • event   = a map of the tool's inputSchema properties → values (the tool arguments).
//   • context.clientContext.custom.bedrockAgentCoreToolName = "${target_name}___${tool_name}".
//   • The handler must return a plain JSON-serializable value.
//
// One deployment serves ONE persona (seller | vendor), selected by the PERSONA env var.
import { sellerOperations } from "./operations/seller.js";
import { vendorOperations } from "./operations/vendor.js";
import type { ClientConfig, Region } from "./spapiClient.js";
import { WRITE_TOOLS } from "./writeTools.js";

const DELIMITER = "___";
const PERSONA = (process.env.PERSONA ?? "seller").toLowerCase();

type Operation = (cfg: ClientConfig, args: Record<string, unknown>) => Promise<unknown>;

function resolveOps(): Map<string, Operation> {
  const ops = (PERSONA === "vendor" ? vendorOperations : sellerOperations) as unknown as Record<string, Operation>;
  // Write tools are opt-in: a default deployment is read-only.
  const writesEnabled = process.env.ENABLE_WRITE_TOOLS === "true";
  // A Map (not a plain object) so only the operations' own names resolve — never
  // inherited keys such as "constructor" or "toString".
  return new Map(Object.entries(ops).filter(([name]) => writesEnabled || !WRITE_TOOLS.has(name)));
}
const OPS: Map<string, Operation> = resolveOps();

const cfg: ClientConfig = {
  region: (process.env.SP_API_REGION as Region) ?? "NA",
  secretId: process.env.SP_API_SECRET_NAME ?? "",
  sandbox: process.env.SP_API_SANDBOX === "true",
};

// Minimal shape of the context AgentCore Gateway passes. Node populates clientContext
// from the invoke's ClientContext; we read both casings defensively.
interface GatewayContext {
  clientContext?: {
    Custom?: Record<string, string>;
    custom?: Record<string, string>;
  };
}

export const handler = async (
  event: Record<string, unknown>,
  context: GatewayContext,
): Promise<unknown> => {
  const custom = context.clientContext?.Custom ?? context.clientContext?.custom ?? {};
  const rawToolName = custom["bedrockAgentCoreToolName"];
  if (!rawToolName) {
    throw new Error("Missing bedrockAgentCoreToolName in Lambda client context");
  }

  // Strip the "${target_name}___" prefix that the Gateway prepends to the visible tool name.
  const idx = rawToolName.indexOf(DELIMITER);
  const toolName = idx >= 0 ? rawToolName.slice(idx + DELIMITER.length) : rawToolName;

  const op = OPS.get(toolName);
  if (!op) {
    throw new Error(
      `Unknown tool '${toolName}' for persona '${PERSONA}'. Available: ${[...OPS.keys()].join(", ")}`,
    );
  }

  const args: Record<string, unknown> = { ...event };

  // Seller writes target the merchant's own catalog; inject the deployer's SELLER_ID
  // so the calling agent never has to supply it.
  if (PERSONA === "seller" && args.sellerId === undefined && process.env.SELLER_ID) {
    args.sellerId = process.env.SELLER_ID;
  }

  return op(cfg, args);
};
