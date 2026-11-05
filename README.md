# MCP connector for Amazon Quick and the Amazon Selling Partner API, using Amazon Bedrock AgentCore Gateway

A **repeatable, AWS CloudFormation-based reference** for connecting **Amazon Quick** (Enterprise) to the **Amazon Selling Partner API (SP-API)** so Quick can perform *agentic actions* and build dashboards — in chat, flows, and automations — against live SP-API data.

> **This is sample code, for non-production usage.** You should work with your security and legal teams to meet your organizational security, regulatory and compliance requirements before deployment. Deploying it creates AWS resources (AWS Lambda, Amazon Cognito, Amazon Bedrock AgentCore Gateway, AWS Secrets Manager, Amazon S3) that may incur charges — run `./teardown.sh <persona>` when you are done.

> Adapted from Amazon's SP-API samples ([amzn/selling-partner-api-samples](https://github.com/amzn/selling-partner-api-samples)) — see [Credits & license](#credits--license).

It ships **two independent tracks** that share one codebase:

- **Seller** — orders, catalog, listings, pricing & fees, fulfillment (MCF), merchant shipping, finances, buyer engagement, analytics (Sales, FBA inventory, Data Kiosk sales & traffic), and reports. **39 tools**.
- **Vendor (1P)** — purchase orders, transaction status, shipments, invoices, analytics (Data Kiosk vendor sales/inventory/traffic/forecasting), reports, and the Direct Fulfillment suite. **23 tools**.

**Read-only by default.** Tools that change account data (repricing, listings, PO acknowledgements, shipments, invoices — 9 seller, 8 vendor) are only published and dispatchable when you set `ENABLE_WRITE_TOOLS="true"`. Without it Quick sees 30 seller / 15 vendor read tools.

See **[docs/TOOLS.md](docs/TOOLS.md)** for the full generated tool list and **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** for the role and sandbox-vs-production matrix.

## Quickstart — pick your path

**Which one are you?** A **Seller** sells on the Amazon marketplace (Seller Central). A **Vendor (1P)** sells *to* Amazon via purchase orders (Vendor Central). Set up the track that matches you — each becomes its own connector in Quick. (Do both if you're both.)

**You'll need:** Amazon **Quick (Enterprise)**, an **SP-API app** + refresh token, and an **AWS account** (CLI + Node 22+). Which roles each tool needs → [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

### 🛍️ Seller
1. **Configure** — `cp .env.sample .env`, fill in `LWA_CLIENT_ID` / `LWA_CLIENT_SECRET` / `SP_API_REFRESH_TOKEN`, and set `SP_API_SECRET_NAME="quick-spapi/seller/lwa"`. Keep `SP_API_SANDBOX="true"` to try it safely first.
2. **Deploy** — `./deploy.sh seller`  → prints your Quick connector values (endpoint, token URL, client id, scope) and the command that retrieves the client secret.
3. **Connect** — in Quick: **Connectors → Create → MCP**, paste those values ([step-by-step](docs/quick-connector-setup.md)).
4. **Try it** — ask Quick: *"Get order `TEST_CASE_200` and list its items."* · *"Show current offers for SKU `NABetaASINB00V5DG6IQ`."* · *"Show my FBA inventory."*
5. **Go live** — set `SP_API_SANDBOX="false"`, add any missing roles, re-run `./deploy.sh seller`, and use your real order ids/SKUs.

### 🏭 Vendor (1P)
1. **Configure** — `cp .env.sample .env.vendor`, fill in your vendor creds, and set `SP_API_SECRET_NAME="quick-spapi/vendor/lwa"`. Keep `SP_API_SANDBOX="true"`.
2. **Deploy** — `./deploy.sh vendor`  → prints your connector values.
3. **Connect** — add a **second** MCP connector in Quick with those values.
4. **Try it** — ask Quick: *"Show vendor purchase orders created between 2024-01-01 and 2024-12-31."* · *"Get PO `4Z32PABC`."* · *"Status of my open POs."*
5. **Go live** — set `SP_API_SANDBOX="false"`, add the vendor analytics role, re-run `./deploy.sh vendor`.

> In **sandbox** use the fixed sample ids shown above; in **production** use your real ids. Write tools (repricing, acknowledgements, etc.) are off until you set `ENABLE_WRITE_TOOLS="true"` and re-deploy; once on, each write asks for confirmation in Quick before it runs.

## Why this shape

- Quick's MCP integration connects to **remote, HTTP-streaming MCP servers** only (not local stdio) and needs **Enterprise**.
- SP-API auth is a **Login with Amazon (LWA) `refresh_token` grant** + an `x-amz-access-token` header (not standard `Authorization: Bearer`), with per-region endpoints — so a thin adapter owns that logic.
- **AgentCore Gateway** turns a **Lambda** into MCP tools and exposes a managed MCP endpoint with **inbound OAuth (`CUSTOM_JWT`)**. Quick is the agent; the Gateway is the tool surface; the Lambda holds SP-API specifics.

```
Amazon Quick (Enterprise)                                  [region: NA]
  │  MCP over HTTPS + JWT bearer (Cognito, client_credentials)
  ▼
AgentCore Gateway  (AuthorizerType: CUSTOM_JWT → Cognito discovery URL)
  │  GatewayTarget(s) → Lambda (Gateway IAM role)
  ▼
Lambda "SP-API adapter"  (per persona: seller | vendor)
  • LWA refresh_token → access_token   • x-amz-access-token header
  • NA endpoint + 429 backoff
  • Reports & Data Kiosk async runners • Secrets Manager holds LWA creds
  ▼
https://sellingpartnerapi-na.amazon.com   (or sandbox.* when SP_API_SANDBOX=true)
```

## Repository layout

```
sample-mcp-connector-for-amazon-quick-and-sp-api/
├── README.md                       # this guide
├── LICENSE                         # MIT-0
├── .env.sample                     # per-follower configuration
├── deploy.sh                       # one-command repeatable deploy (per persona)
├── teardown.sh                     # delete a persona's stacks + gateway targets
├── scripts/
│   └── gen-tool-schemas.mjs        # generates tool-schemas/*.json + docs/TOOLS.md
├── lambda/
│   ├── package.json                # build (esbuild) + typecheck + vitest
│   └── src/
│       ├── auth.ts                 # LWA token exchange
│       ├── spapiClient.ts          # endpoints (sandbox/prod), 429 backoff
│       ├── reports.ts              # Reports API async runner (shared)
│       ├── dataKiosk.ts            # Data Kiosk runner + seller sales & traffic
│       ├── vendorDataKiosk.ts      # vendor analytics query builder
│       ├── handler.ts              # Gateway-target entrypoint: dispatch by tool
│       └── operations/
│           ├── seller.ts           # seller op map
│           ├── sellerExtra.ts      # orders, catalog, listings, pricing/fees, MCF, MFN, finances, account
│           ├── vendor.ts           # vendor op map
│           ├── vendorExtra.ts      # transaction status, shipments, invoices, forecasting, reports
│           └── vendorDirectFulfillment.ts   # DF suite (DF vendors only)
├── tool-schemas/
│   ├── seller.tools.json           # primary seller target schema (generated)
│   └── vendor.tools.json           # vendor target schema (generated)
├── infra/                          # CloudFormation
│   ├── 01-secrets.yaml             # Secrets Manager (LWA creds) per persona
│   ├── 02-inbound-cognito.yaml     # Cognito user pool + resource server + M2M app client
│   ├── 03-lambda.yaml              # Lambda + execution role (persona/sandbox/write-tool params)
│   └── 04-gateway.yaml             # AgentCore Gateway (CUSTOM_JWT → Cognito) + gateway role
└── docs/
    ├── TOOLS.md                    # generated tool reference
    ├── REQUIREMENTS.md             # roles / buyer data / sandbox-vs-production matrix
    └── quick-connector-setup.md    # wiring the MCP connector(s) in Quick
```

## Prerequisites

- Amazon **Quick Enterprise**.
- An SP-API **developer application** (seller and/or vendor) with the operation **roles** authorized and a **refresh token** per selling partner — see [SP-API registration](https://developer-docs.amazon.com/sp-api/docs/sp-api-registration-overview) and [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md). You are responsible for complying with the SP-API [Policies and Agreements](https://developer-docs.amazon.com/sp-api/docs/policies-and-agreements), including the Acceptable Use Policy and the Data Protection Policy, for all data you retrieve and route through Amazon Quick.
- AWS account with Bedrock AgentCore access; AWS CLI with the `bedrock-agentcore-control` service; Node 22+; `zip`.

## Configuration

Each persona has its own env file — **`.env`** for seller, **`.env.vendor`** for vendor. `deploy.sh` uses `.env.<persona>` if it exists, otherwise `.env`. Copy the sample and fill it in:

```bash
cp .env.sample .env           # seller     (for vendor: cp .env.sample .env.vendor)
```

**1. Set these** (required):

| Variable | What to put |
|---|---|
| `LWA_CLIENT_ID`, `LWA_CLIENT_SECRET` | Your SP-API app's LWA client ID and client secret |
| `SP_API_REFRESH_TOKEN` | Refresh token for the authorized seller/vendor |
| `SP_API_SECRET_NAME` | Name for the Secrets Manager secret — **use a distinct one per persona**, e.g. `quick-spapi/seller/lwa` or `quick-spapi/vendor/lwa` |

**2. Leave the defaults** unless you need to change them:

| Variable | Default | Change it when… |
|---|---|---|
| `SP_API_SANDBOX` | `true` — safe, canned data | you're ready for real data → `false` |
| `SP_API_REGION` | `NA` | (this reference targets North America) |
| `ENABLE_WRITE_TOOLS` | `false` — read-only | you want Quick to change account data (repricing, listings, PO acknowledgements, shipments, invoices) → `true` |
| `SELLER_ID` | empty | you use the Listings tools (your merchant token) |
| `LOG_RETENTION_DAYS` | `30` | you need the adapter's logs kept longer or shorter |
| `RESERVED_CONCURRENCY` | empty — not reserved | you want to cap concurrent executions (e.g. `5`). Leave empty on accounts with a total Lambda concurrency limit of 10, where reserving fails |
| `AWS_REGION`, `STACK_PREFIX` | `us-east-1`, `quick-spapi` | you want a different region / stack-name prefix |

## Deploy (repeatable)

**Prerequisite:** AWS CLI (with the `bedrock-agentcore-control` service) + credentials that can create CloudFormation, IAM, Lambda, Cognito, S3, Secrets Manager, and AgentCore resources; Node 22+; `zip`.

```bash
./deploy.sh seller            # or: ./deploy.sh vendor
```

It's safe to re-run (idempotent). Each run:

1. builds + bundles the Lambda and uploads it to an S3 deploy bucket (public access blocked, encrypted, HTTPS-only);
2. deploys 4 CloudFormation stacks — `${STACK_PREFIX}-${persona}-{secrets, cognito, lambda, gateway}`;
3. stores your LWA credentials in Secrets Manager;
4. creates/updates the AgentCore **Gateway target** from `tool-schemas/<persona>.tools.json` — read tools only unless `ENABLE_WRITE_TOOLS=true`;
5. **prints the values you paste into Quick** — Gateway MCP URL, token endpoint, client id and scope — plus the command that retrieves the client secret. The secret itself is never printed, so it does not end up in terminal history or CI logs.

Then register them → **[docs/quick-connector-setup.md](docs/quick-connector-setup.md)**.

> **Going to production:** set `SP_API_SANDBOX="false"` in your `.env*`, confirm the needed [roles](docs/REQUIREMENTS.md) are authorized, and re-run `./deploy.sh <persona>`. Same credentials — only the endpoint changes. If you have enabled write tools, they now change real data, so keep Quick's human-in-the-loop confirmation on.

## Tools & capabilities

Full list in **[docs/TOOLS.md](docs/TOOLS.md)**. Conventions:

- **Reads** use typed arguments; **writes** are marked `WRITE:`, are off unless `ENABLE_WRITE_TOOLS=true`, and should stay behind Quick's human-in-the-loop confirmation.
- **Complex writes** (create MCF order, buy MFN label, `put_listings_item`, vendor shipment/invoice, DF suite) take a `body` pass-through — supply the SP-API request body.
- **Async** tools (`get_sales_and_traffic`, `get_vendor_*`, `run_report`) create a query/report, poll (~90s), and return rows — or a `queryId`/`reportId` to fetch later with `get_data_kiosk_result` / `get_report_result`. They return real data **in production**.
- The Gateway paginates `tools/list`; Quick follows the cursor and sees all tools.
- **Account Health:** there is no dedicated tool. Sellers can get Account Health metrics (Order Defect Rate, late-shipment rate, policy violations, Account Health Rating) with `run_report` and report type `GET_V2_SELLER_PERFORMANCE_REPORT`, which needs the Selling Partner Insights role. The report is not available to vendors.

## Testing

```bash
cd lambda && npm test        # 33 vitest unit tests (auth, request shaping, dispatch, input validation, path-argument checks, write gating, error-message redaction, schema↔ops parity)
./validate.sh                # regenerate schemas + typecheck + tests + CFN validate + shell lint
```

Sandbox uses fixed sample values (e.g. order `TEST_CASE_200`, SKU `NABetaASINB00V5DG6IQ`, vendor PO `4Z32PABC`). Ready-made prompts and sample ids are in [docs/quick-connector-setup.md](docs/quick-connector-setup.md).

## Cost

You are responsible for the cost of the AWS services you use while running this sample. There is no fixed or hourly charge for the resources it creates — everything is pay-per-use — but Amazon Cognito machine-to-machine token requests and the Secrets Manager secret are charged from the first use, with no free tier.

Prices below are for **US East (N. Virginia)** as published at the time of writing. Check the linked pricing pages for current rates and your Region.

| Service | What this sample uses it for | Price |
|---|---|---|
| [Amazon Bedrock AgentCore Gateway](https://aws.amazon.com/bedrock/agentcore/pricing/) | MCP endpoint Quick calls | $0.005 per 1,000 invocations (`ListTools`, `InvokeTool`, `Ping`). Search and tool-indexing charges apply only to gateways with semantic search enabled; this sample does not enable it |
| [Amazon Cognito](https://aws.amazon.com/cognito/pricing/) | Machine-to-machine (client credentials) tokens for Quick | $0.00225 per successful token request; no free tier for M2M; no charge per app client |
| [AWS Lambda](https://aws.amazon.com/lambda/pricing/) | SP-API adapter (256 MB, x86) | $0.20 per 1M requests + $0.0000166667 per GB-second; free tier of 1M requests and 400,000 GB-seconds per month |
| [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) | One secret holding the LWA credentials | $0.40 per secret per month + $0.05 per 10,000 API calls |
| [Amazon S3](https://aws.amazon.com/s3/pricing/) | Lambda deployment packages | Standard storage and request rates; a few MB per deploy |
| [Amazon CloudWatch Logs](https://aws.amazon.com/cloudwatch/pricing/) | Lambda logs, kept `LOG_RETENTION_DAYS` | Standard ingestion and storage rates |

**Worked example — one persona, 10,000 tool calls a month, 1,000 Cognito token requests, 2 s average run time:**

| Item | Calculation | Monthly |
|---|---|---|
| Gateway invocations | 10,000 × $0.005 / 1,000 | $0.05 |
| Cognito tokens | 1,000 × $0.00225 | $2.25 |
| Lambda | 10,000 × 2 s × 0.25 GB = 5,000 GB-s, + 10,000 requests — within the free tier | $0.00 ($0.09 without it) |
| Secrets Manager | 1 secret; API calls are cached per Lambda container | $0.40 |
| S3, CloudWatch Logs | small | < $0.10 |
| **Total** | | **≈ $2.80** |

How often Quick requests a new Cognito token depends on its token caching, which makes that line the most variable. Deploying both personas roughly doubles the total.

**Not included:** your **Amazon Quick** subscription (Enterprise is required), and any fees that apply to your SP-API developer account — check the current SP-API [Policies and Agreements](https://developer-docs.amazon.com/sp-api/docs/policies-and-agreements).

Run `./teardown.sh <persona>` to stop all charges. Teardown leaves the S3 deploy bucket in place; empty and delete it (`${STACK_PREFIX}-deploy-<account-id>`) to remove the last stored packages.

## Teardown

```bash
./teardown.sh seller         # deletes the gateway target(s) + 4 stacks for that persona
./teardown.sh vendor
```

Deleting the secrets stack **permanently deletes** the persona's Secrets Manager secret — CloudFormation deletes it immediately, with no recovery window, so it cannot be restored. Redeploying with the same `SP_API_SECRET_NAME` works; `deploy.sh` writes the LWA credentials from your `.env*` file again.

## Responsible AI

This sample gives an AI agent (Amazon Quick) tools that read — and, if you enable them, change — a real selling account. Keep these points in mind:

- **The agent can be wrong.** It may misread data, pick the wrong tool or arguments, or summarize inaccurately. Check figures and recommendations against Seller Central / Vendor Central before acting on them; decisions about pricing, listings and purchase orders stay with people.
- **Returned data is untrusted input to the agent.** Listing text, buyer messages and report fields are written by third parties and can contain instructions aimed at the agent (prompt injection). That is why write tools are off by default.
- **Keep a human in the loop for every change.** If you set `ENABLE_WRITE_TOOLS=true`, keep Quick's confirmation step on so each write is reviewed before it runs, and enable only for the users who need it.
- **Scope who can ask.** Attach each connector only to the Quick spaces and users that should see that account's data.
- **Transparency.** Tell users when answers come from an AI assistant using live account data, and which account they are connected to.

## Security

- LWA credentials live in **Secrets Manager**, read by the Lambda at runtime — never in the template or logs. `.env*` files are git-ignored.
- **Read-only by default:** write tools are neither published to the Gateway nor dispatchable by the Lambda unless `ENABLE_WRITE_TOOLS=true`.
- **No buyer PII tools:** SP-API returns buyer personal data (names, email addresses, phone numbers, street addresses) only to calls made with a Restricted Data Token, and this release never requests one. All SP-API data you retrieve is still subject to Amazon's [Data Protection Policy](https://developer-docs.amazon.com/sp-api/docs/policies-and-agreements) and your own privacy obligations.
- Least privilege: scope the SP-API app's roles and the Quick connector's sharing to what you actually use.

### Rotating credentials and revoking access

Each deployment holds two kinds of credential. Rotate them on a schedule, and immediately when someone who could see them leaves or you suspect exposure.

**Cognito client secret** (what Quick uses to call the Gateway — retrieved on demand with the command `deploy.sh` prints, stored in the Quick connector):

1. Add a second secret to the app client with the Cognito [`AddUserPoolClientSecret`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AddUserPoolClientSecret.html) operation (console, SDK, or a recent AWS CLI). An app client can hold [two secrets at a time](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html), so Quick keeps working during the switch.
2. In Quick, open the connector details page and choose **Sync**; when Quick asks for the client secret, enter the new one.
3. Remove the old secret with [`DeleteUserPoolClientSecret`](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_DeleteUserPoolClientSecret.html).

To cut off a leaked secret, do steps 1 and 3 straight away: the old secret can no longer obtain tokens, and any access token already issued with it expires within the app client's access-token validity (60 minutes by default).

**LWA client secret and refresh token** (what the Lambda uses to call SP-API — stored in Secrets Manager):

1. Rotate the LWA client secret with the SP-API Application Management API (`rotateApplicationClientSecret`) — see [Rotate your application client secret](https://developer-docs.amazon.com/sp-api/docs/rotate-your-application-client-secret). Amazon sends an `APPLICATION_OAUTH_CLIENT_SECRET_EXPIRY` notification before a secret expires; the [`lwa-rotation`](https://github.com/amzn/selling-partner-api-samples/tree/main/use-cases/lwa-rotation) sample automates the full cycle.
2. To invalidate the refresh token, remove the app's authorization from the selling account, then authorize it again to obtain a new refresh token.
3. Put the new values in your `.env*` file and re-run `./deploy.sh <persona>`. This updates the secret **and** deploys a new Lambda package, so no execution environment keeps using the cached old credentials.
4. Delete or securely store any copies of the old values (terminal history, notes, `.env` backups).

**Reporting a security issue:** please use the AWS/Amazon [vulnerability reporting](https://aws.amazon.com/security/vulnerability-reporting/) process — do **not** open a public GitHub issue. See [CONTRIBUTING.md](CONTRIBUTING.md#security-issue-notifications).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Credits & license

This solution is built on and adapted from the **[amzn/selling-partner-api-samples](https://github.com/amzn/selling-partner-api-samples)** repository (Amazon Selling Partner API sample code), which is Amazon-owned and MIT-0 licensed. The portions used here were adapted and rewritten for this sample and are distributed under this repository's MIT-0 license. Specifically it reuses/adapts:

- **SP-API auth + call pattern** — LWA `refresh_token` → `x-amz-access-token`, regional endpoints, and 429 handling — grounded in [`use-cases/sp-api-dev-mcp`](https://github.com/amzn/selling-partner-api-samples/tree/main/use-cases/sp-api-dev-mcp) (the Dev Assistant's `execute-api-tool.ts` / `auth/sp-api-auth.ts`).
- **Data Kiosk GraphQL query builders** — seller `salesAndTrafficByDate` and vendor `vendorAnalytics` — adapted from [`use-cases/amazon-data-kiosk-mcp-server`](https://github.com/amzn/selling-partner-api-samples/tree/main/use-cases/amazon-data-kiosk-mcp-server) (`seller-server` / `vendor-server`).
- **Data Kiosk schema names and sample queries** referenced from the repo's [`code-recipes`](https://github.com/amzn/selling-partner-api-samples/tree/main/code-recipes) and [`use-cases/data-kiosk`](https://github.com/amzn/selling-partner-api-samples/tree/main/use-cases/data-kiosk).

The sandbox sample ids (`TEST_CASE_200`, `NABetaASINB00V5DG6IQ`, `4Z32PABC`) are the static-sandbox values defined in Amazon's public SP-API models, [amzn/selling-partner-api-models](https://github.com/amzn/selling-partner-api-models).

The AgentCore Gateway/MCP mechanics were built from the official [Amazon Bedrock AgentCore documentation](https://docs.aws.amazon.com/bedrock-agentcore/).

Licensed under **MIT-0** — see the [LICENSE](LICENSE) file. Educational sample — not a supported product; test, secure, and harden before production use.
