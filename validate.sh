#!/usr/bin/env bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# One-command validation for the reference. Run from the project root: ./validate.sh
# Regenerates schemas/docs, typechecks + tests the Lambda, validates CloudFormation
# (if AWS creds are present), and syntax-checks the shell scripts.
set -euo pipefail
cd "$(dirname "$0")"

echo "1/5 regenerate tool schemas + docs/TOOLS.md (schema↔ops parity is asserted by the unit tests)"
node scripts/gen-tool-schemas.mjs

echo "2/5 lambda install + typecheck"
( cd lambda && npm ci --silent && npm run typecheck )

echo "3/5 unit tests"
( cd lambda && npm test )

echo "4/5 CloudFormation templates"
if aws sts get-caller-identity >/dev/null 2>&1; then
  for f in infra/*.yaml; do
    aws cloudformation validate-template --template-body "file://$f" >/dev/null && echo "   ok $f"
  done
else
  echo "   (no AWS credentials detected — skipping CFN validate-template)"
fi

echo "5/5 shell syntax"
bash -n deploy.sh && bash -n teardown.sh && echo "   ok deploy.sh, teardown.sh"

echo "PASS"
