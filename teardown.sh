#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Tear down one persona's stack. Usage: ./teardown.sh <seller|vendor>
# Deletes the (CLI-created) gateway target first, then the 4 CloudFormation stacks.
# Leaves the shared S3 deploy bucket (negligible cost); remove it manually if desired.
set -euo pipefail

PERSONA="${1:-}"
case "$PERSONA" in seller|vendor) ;; *) echo "Usage: ./teardown.sh <seller|vendor>"; exit 1 ;; esac

# Same env-file selection as deploy.sh: prefer .env.<persona>, else .env.
ENV_FILE=".env.${PERSONA}"
[ -f "$ENV_FILE" ] || ENV_FILE=".env"
[ -f "$ENV_FILE" ] || { echo "ERROR: create $ENV_FILE (or .env) first."; exit 1; }
# The persona ARGUMENT is the source of truth. An env file may not override it — otherwise
# "./deploy.sh vendor" could deploy onto (or teardown delete) the seller stacks.
ARG_PERSONA="$PERSONA"
set -a; . "./$ENV_FILE"; set +a
if [ "${PERSONA:-$ARG_PERSONA}" != "$ARG_PERSONA" ]; then
  echo "ERROR: $ENV_FILE sets PERSONA=\"$PERSONA\" but you ran this for \"$ARG_PERSONA\". Remove PERSONA from $ENV_FILE."; exit 1
fi
PERSONA="$ARG_PERSONA"
: "${AWS_REGION:?}" ; PREFIX="${STACK_PREFIX:-quick-spapi}"

# 1. Delete the gateway target(s) so the gateway stack can be deleted.
GW_ID="$(aws cloudformation describe-stacks --stack-name "${PREFIX}-${PERSONA}-gateway" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='GatewayIdentifier'].OutputValue" --output text 2>/dev/null || echo '')"
if [ -n "$GW_ID" ] && [ "$GW_ID" != "None" ]; then
  for TID in $(aws bedrock-agentcore-control list-gateway-targets --region "$AWS_REGION" \
      --gateway-identifier "$GW_ID" --query 'items[].targetId' --output text 2>/dev/null); do
    echo "deleting gateway target $TID"
    aws bedrock-agentcore-control delete-gateway-target --region "$AWS_REGION" \
      --gateway-identifier "$GW_ID" --target-id "$TID" || true
  done
fi

# 2. Delete stacks (reverse dependency order).
for s in gateway lambda cognito secrets; do
  STACK="${PREFIX}-${PERSONA}-$s"
  echo "deleting stack $STACK"
  aws cloudformation delete-stack --stack-name "$STACK" --region "$AWS_REGION" || true
  aws cloudformation wait stack-delete-complete --stack-name "$STACK" --region "$AWS_REGION" 2>/dev/null || true
done

echo "Teardown complete for ${PERSONA}. (Deploy bucket ${PREFIX}-deploy-<account> left in place;"
echo "the Secrets Manager secret was deleted permanently, with no recovery window.)"
