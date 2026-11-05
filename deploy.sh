#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Repeatable deploy for the Amazon Quick <-> SP-API AgentCore connector (NA).
#
#   Usage: ./deploy.sh <seller|vendor>
#
# Deploys 4 CloudFormation stacks (secrets, Cognito inbound, Lambda, Gateway) and
# then creates/updates the AgentCore GatewayTarget via the AWS CLI (so it can reuse
# tool-schemas/<persona>.tools.json verbatim). Prints the values to register in Quick.
set -euo pipefail

PERSONA="${1:-}"
case "$PERSONA" in
  seller|vendor) ;;
  *) echo "Usage: ./deploy.sh <seller|vendor>"; exit 1 ;;
esac

# ── Load config (prefer a per-persona .env.<persona>, else .env) ──
ENV_FILE=".env.${PERSONA}"
[ -f "$ENV_FILE" ] || ENV_FILE=".env"
[ -f "$ENV_FILE" ] || { echo "ERROR: create $ENV_FILE (or .env) from .env.sample first."; exit 1; }
echo "using env file: $ENV_FILE"
# The persona ARGUMENT is the source of truth. An env file may not override it — otherwise
# "./deploy.sh vendor" could deploy onto (or teardown delete) the seller stacks.
ARG_PERSONA="$PERSONA"
set -a; . "./$ENV_FILE"; set +a
if [ "${PERSONA:-$ARG_PERSONA}" != "$ARG_PERSONA" ]; then
  echo "ERROR: $ENV_FILE sets PERSONA=\"$PERSONA\" but you ran this for \"$ARG_PERSONA\". Remove PERSONA from $ENV_FILE."; exit 1
fi
PERSONA="$ARG_PERSONA"
: "${AWS_REGION:?set AWS_REGION in .env}"
: "${STACK_PREFIX:?set STACK_PREFIX in .env}"
: "${SP_API_SECRET_NAME:?set SP_API_SECRET_NAME in .env}"
: "${LWA_CLIENT_ID:?}" ; : "${LWA_CLIENT_SECRET:?}" ; : "${SP_API_REFRESH_TOKEN:?}"
SP_API_REGION="${SP_API_REGION:-NA}"
SP_API_SANDBOX="${SP_API_SANDBOX:-false}"
ENABLE_WRITE_TOOLS="${ENABLE_WRITE_TOOLS:-false}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"
RESERVED_CONCURRENCY="${RESERVED_CONCURRENCY:-}"
SELLER_ID="${SELLER_ID:-}"
PREFIX="$STACK_PREFIX"

# ── Preflight ──
command -v aws >/dev/null || { echo "ERROR: AWS CLI not found."; exit 1; }
aws bedrock-agentcore-control help >/dev/null 2>&1 || {
  echo "ERROR: your AWS CLI lacks 'bedrock-agentcore-control'. Install or update AWS CLI v2 using the official guide:"
  echo "       https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"; exit 1; }
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

out() { # stack, output-key
  aws cloudformation describe-stacks --stack-name "$1" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

echo "== 1/6 Build + package Lambda =="
( cd lambda && rm -rf dist function.zip && npm ci --silent && npm run build )
DEPLOY_BUCKET="${PREFIX}-deploy-${ACCOUNT_ID}"
aws s3api head-bucket --bucket "$DEPLOY_BUCKET" 2>/dev/null \
  || aws s3 mb "s3://$DEPLOY_BUCKET" --region "$AWS_REGION"
# Harden the deploy bucket explicitly (re-applied every run): no public access,
# default encryption, and HTTPS-only access.
aws s3api put-public-access-block --bucket "$DEPLOY_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$DEPLOY_BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-policy --bucket "$DEPLOY_BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"DenyInsecureTransport\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::${DEPLOY_BUCKET}\",\"arn:aws:s3:::${DEPLOY_BUCKET}/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}]}"
( cd lambda/dist && zip -q -r ../function.zip . )
CODE_KEY="lambda/${PERSONA}/handler-$(date +%Y%m%d%H%M%S).zip"
aws s3 cp lambda/function.zip "s3://${DEPLOY_BUCKET}/${CODE_KEY}" >/dev/null

echo "== 2/6 Secrets =="
aws cloudformation deploy --region "$AWS_REGION" \
  --stack-name "${PREFIX}-${PERSONA}-secrets" \
  --template-file infra/01-secrets.yaml \
  --parameter-overrides SecretName="$SP_API_SECRET_NAME"
# Pass the credentials via an owner-only temp file, never as a command-line argument
# (arguments are visible to other local users in the process list).
SECRET_FILE="$(umask 077 && mktemp)"
trap 'rm -f "$SECRET_FILE"' EXIT
printf '{"LWA_CLIENT_ID":"%s","LWA_CLIENT_SECRET":"%s","SP_API_REFRESH_TOKEN":"%s"}' \
  "$LWA_CLIENT_ID" "$LWA_CLIENT_SECRET" "$SP_API_REFRESH_TOKEN" > "$SECRET_FILE"
aws secretsmanager put-secret-value --region "$AWS_REGION" \
  --secret-id "$SP_API_SECRET_NAME" \
  --secret-string "file://${SECRET_FILE}" >/dev/null
rm -f "$SECRET_FILE"
SECRET_ARN="$(out "${PREFIX}-${PERSONA}-secrets" SecretArn)"

echo "== 3/6 Cognito inbound authorizer =="
aws cloudformation deploy --region "$AWS_REGION" \
  --stack-name "${PREFIX}-${PERSONA}-cognito" \
  --template-file infra/02-inbound-cognito.yaml \
  --parameter-overrides Prefix="$PREFIX" Persona="$PERSONA"
DISCOVERY_URL="$(out "${PREFIX}-${PERSONA}-cognito" DiscoveryUrl)"
TOKEN_ENDPOINT="$(out "${PREFIX}-${PERSONA}-cognito" TokenEndpoint)"
CLIENT_ID="$(out "${PREFIX}-${PERSONA}-cognito" ClientId)"
SCOPE="$(out "${PREFIX}-${PERSONA}-cognito" AllowedScope)"
USER_POOL_ID="$(out "${PREFIX}-${PERSONA}-cognito" UserPoolId)"

echo "== 4/6 Lambda =="
aws cloudformation deploy --region "$AWS_REGION" \
  --stack-name "${PREFIX}-${PERSONA}-lambda" \
  --template-file infra/03-lambda.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides Prefix="$PREFIX" Persona="$PERSONA" SecretArn="$SECRET_ARN" \
    CodeS3Bucket="$DEPLOY_BUCKET" CodeS3Key="$CODE_KEY" \
    SpApiRegion="$SP_API_REGION" SpApiSandbox="$SP_API_SANDBOX" \
    SellerId="$SELLER_ID" \
    EnableWriteTools="$ENABLE_WRITE_TOOLS" LogRetentionDays="$LOG_RETENTION_DAYS" \
    ReservedConcurrency="$RESERVED_CONCURRENCY"
LAMBDA_ARN="$(out "${PREFIX}-${PERSONA}-lambda" FunctionArn)"

echo "== 5/6 Gateway (CUSTOM_JWT via Cognito) =="
aws cloudformation deploy --region "$AWS_REGION" \
  --stack-name "${PREFIX}-${PERSONA}-gateway" \
  --template-file infra/04-gateway.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides Prefix="$PREFIX" Persona="$PERSONA" \
    DiscoveryUrl="$DISCOVERY_URL" AllowedClientId="$CLIENT_ID" LambdaArn="$LAMBDA_ARN"
GATEWAY_ID="$(out "${PREFIX}-${PERSONA}-gateway" GatewayIdentifier)"
GATEWAY_URL="$(out "${PREFIX}-${PERSONA}-gateway" GatewayUrl)"

echo "== 6/6 Gateway target (reuses tool-schemas/${PERSONA}.tools.json) =="
TARGET_NAME="spapi${PERSONA}"   # must match ^([0-9a-zA-Z][-]?){1,100}$ — no underscores
# Publish only read tools unless ENABLE_WRITE_TOOLS=true, so Quick never lists a write
# tool the Lambda would refuse (the Lambda enforces the same rule independently).
TOOL_SCHEMA="$(ENABLE_WRITE_TOOLS="$ENABLE_WRITE_TOOLS" node -e "
  const t = require('./tool-schemas/${PERSONA}.tools.json');
  const keep = process.env.ENABLE_WRITE_TOOLS === 'true' ? t : t.filter(x => !/^(DF only )?WRITE/.test(x.description));
  process.stdout.write(JSON.stringify(keep));")"
[ "$ENABLE_WRITE_TOOLS" = "true" ] || echo "   read-only: write tools not published (set ENABLE_WRITE_TOOLS=true to enable)"
TARGET_CONFIG="{\"mcp\":{\"lambda\":{\"lambdaArn\":\"${LAMBDA_ARN}\",\"toolSchema\":{\"inlinePayload\":${TOOL_SCHEMA}}}}}"
CRED_CONFIG='[{"credentialProviderType":"GATEWAY_IAM_ROLE"}]'
EXISTING_TARGET_ID="$(aws bedrock-agentcore-control list-gateway-targets --region "$AWS_REGION" \
  --gateway-identifier "$GATEWAY_ID" \
  --query "items[?name=='${TARGET_NAME}'].targetId | [0]" --output text 2>/dev/null || echo None)"
if [ "$EXISTING_TARGET_ID" = "None" ] || [ -z "$EXISTING_TARGET_ID" ]; then
  aws bedrock-agentcore-control create-gateway-target --region "$AWS_REGION" \
    --gateway-identifier "$GATEWAY_ID" --name "$TARGET_NAME" \
    --target-configuration "$TARGET_CONFIG" \
    --credential-provider-configurations "$CRED_CONFIG" >/dev/null
  echo "   created target $TARGET_NAME"
else
  aws bedrock-agentcore-control update-gateway-target --region "$AWS_REGION" \
    --gateway-identifier "$GATEWAY_ID" --target-id "$EXISTING_TARGET_ID" --name "$TARGET_NAME" \
    --target-configuration "$TARGET_CONFIG" \
    --credential-provider-configurations "$CRED_CONFIG" >/dev/null
  echo "   updated target $TARGET_NAME ($EXISTING_TARGET_ID)"
fi

cat <<EOF

============================================================
 Deployed the ${PERSONA} track. Register these in Amazon Quick
 (Connectors -> Create -> Model Context Protocol). See docs/quick-connector-setup.md
------------------------------------------------------------
 MCP endpoint (Gateway URL) : ${GATEWAY_URL}
 OAuth token endpoint       : ${TOKEN_ENDPOINT}
 OAuth client id            : ${CLIENT_ID}
 OAuth scope                : ${SCOPE}
 OAuth client secret        : not printed. Retrieve it only when you paste it into Quick:
   aws cognito-idp describe-user-pool-client --region ${AWS_REGION} \\
     --user-pool-id ${USER_POOL_ID} --client-id ${CLIENT_ID} \\
     --query 'UserPoolClient.ClientSecret' --output text
   (or: Amazon Cognito console -> User pools -> ${PREFIX}-${PERSONA}-pool -> App clients)
 Tools (prefixed ${TARGET_NAME}___):
$(for t in $(printf '%s' "$TOOL_SCHEMA" | node -e "for(const x of JSON.parse(require('fs').readFileSync(0,'utf8')))console.log(x.name)"); do echo "   - ${TARGET_NAME}___${t}"; done)
============================================================
EOF
