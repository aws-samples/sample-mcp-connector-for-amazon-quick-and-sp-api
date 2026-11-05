# Register the connector(s) in Amazon Quick

Each `./deploy.sh <persona>` prints four values (MCP endpoint, token URL, client id, scope) and the command that retrieves the client secret — the secret itself is never printed. Register them as an MCP connector so Quick can call your SP-API tools. Deploy seller and vendor separately → **two connectors**.

## 1. Create the MCP connector

1. In the **Amazon Quick console**, open **Connectors → Create for your team → Model Context Protocol (MCP)**.
2. Fill in:
   - **Name** — e.g. `SP-API Seller` or `SP-API Vendor`.
   - **MCP server endpoint** — the **Gateway URL** from that persona's deploy output.
   - **Connection type** — **Public network**.
3. **Authentication → Service authentication (service-to-service)**:
   - **Client ID**, **Token URL** — from the deploy output for that persona.
   - **Client Secret** — run the `aws cognito-idp describe-user-pool-client …` command from the deploy output and paste the result directly into Quick (or copy it from the Amazon Cognito console). Don't save it in notes or tickets.
   - Scope: only if a field is shown (`quick-spapi-<persona>/invoke`). A token issued without a scope also works.
4. Create, then review the discovered tools. Quick follows `tools/list` pagination automatically, so it lists **all** tools (read-only default: seller 30, vendor 15; with `ENABLE_WRITE_TOOLS=true`: seller 39 across two pages, vendor 23). Tools are prefixed with the target name, e.g. `spapiseller___get_catalog_item`, `spapivendor___get_purchase_orders`.

## 2. Assign to an agent / space
Put each connector in its own **space** with a **bounded agent**, so SP-API access is scoped to intended users. Write tools are only listed if the deployment set `ENABLE_WRITE_TOOLS=true`; if they are, keep **human-in-the-loop confirmation** on for the agent so `WRITE:` tools prompt before running.

## 3. After you add or change tools (sync)
When you redeploy with new/changed tools, open the connector details page and choose **Sync** ([Quick MCP integration](https://docs.aws.amazon.com/quick/latest/userguide/mcp-integration.html)). The sync re-authorizes, so Quick asks for the **client secret** again (it doesn't display the stored one) — retrieve it with the same command from the deploy output; it hasn't rotated. If a sync doesn't surface new tools, remove and re-add the connector.

## 4. Test

**Sandbox** (`SP_API_SANDBOX=true`) — use the fixed sample values:

- Seller: *"Get order `TEST_CASE_200` and list its items."* · *"Show current offers for SKU `NABetaASINB00V5DG6IQ`."* · *"Show my FBA inventory summary."*
- Vendor: *"Show vendor purchase orders created between 2024-01-01 and 2024-12-31."* · *"Get PO `4Z32PABC`."*

**Production** (`SP_API_SANDBOX=false`) — use real order ids / SKUs / date ranges, e.g. *"Build a sales health dashboard for the last 30 days: daily ordered product sales, sessions, and Buy Box %."* (`get_sales_and_traffic`).

## Troubleshooting

- **401 at the Gateway** — the connector's client id must equal the gateway's `AllowedClients`, and both come from the same persona's Cognito stack. Re-check you pasted the values for the *same* persona.
- **Tool runs but SP-API returns 403** — the app is missing that operation's role, or the refresh token isn't authorized for it. See [REQUIREMENTS.md](REQUIREMENTS.md).
- **`400 InvalidInput` in sandbox** — expected; the static sandbox only matches the operation's documented sample params. Use the sample values above, or switch to production.
- **Async tool returns a `queryId`/`reportId`** — it's still processing; call `get_data_kiosk_result` / `get_report_result` with that id.
