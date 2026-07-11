#!/usr/bin/env bash
# Build + deploy the BYOA agent runtime to AgentCore Runtime (idempotent).
#
#   1. esbuild the self-contained bundle (packages/agent-runtime/dist/index.js)
#   2. docker build (linux/arm64 — AgentCore requirement) + push to ECR,
#      tagged with the git sha + timestamp so every release is addressable
#   3. create-agent-runtime or update-agent-runtime pointing at the image
#   4. wait READY, write runtime ARN → SSM
#
# Runs identically on a laptop and in CI (CI just assumes a role first).
# Usage: ENV=dev AWS_PROFILE=metacto REGION=us-west-2 bash infra/agentcore/deploy-runtime.sh
set -euo pipefail

ENV="${ENV:-dev}"
REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-metacto}"
aws() { command aws --region "$REGION" --profile "$PROFILE" "$@"; }

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$ROOT/packages/agent-runtime"
SSM_PREFIX="/vocion/agentcore/${ENV}"
RUNTIME_NAME="vocion_agent_runtime_${ENV}"

REPO_URI=$(aws ssm get-parameter --name "${SSM_PREFIX}/ecr-repo-uri" --query 'Parameter.Value' --output text)
ROLE_ARN=$(aws ssm get-parameter --name "${SSM_PREFIX}/runtime-role-arn" --query 'Parameter.Value' --output text)

echo "== deploy agent-runtime · env=${ENV} → ${REPO_URI} =="

# ---------------------------------------------------------------- 1. bundle
echo "-- building bundle"
( cd "$PKG" && npm run build )
test -f "$PKG/dist/index.js" || { echo "ERROR: no dist/index.js"; exit 1; }

# ---------------------------------------------------------------- 2. image
GIT_SHA=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "nogit")
TAG="${GIT_SHA}-$(date +%Y%m%d%H%M%S)"
IMAGE="${REPO_URI}:${TAG}"

echo "-- docker build ${IMAGE} (linux/arm64)"
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO_URI%%/*}" >/dev/null
docker build --platform linux/arm64 -t "$IMAGE" "$PKG" >/dev/null
docker push "$IMAGE" >/dev/null
echo "-- pushed ${TAG}"

# ---------------------------------------------------------------- 3. runtime
ENV_VARS="{\"VOCION_MODEL_PROVIDER\":\"bedrock\",\"AWS_REGION\":\"${REGION}\"}"
EXISTING_ID=$(aws bedrock-agentcore-control list-agent-runtimes \
  --query "agentRuntimes[?agentRuntimeName=='${RUNTIME_NAME}'].agentRuntimeId | [0]" --output text)

if [[ "$EXISTING_ID" == "None" || -z "$EXISTING_ID" ]]; then
  echo "-- creating runtime ${RUNTIME_NAME}"
  CREATED=$(aws bedrock-agentcore-control create-agent-runtime \
    --agent-runtime-name "$RUNTIME_NAME" \
    --description "Vocion BYOA agent runtime (${ENV}) — deepagents loop, tools via core endpoint" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${IMAGE}\"}}" \
    --role-arn "$ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --environment-variables "$ENV_VARS")
  RUNTIME_ID=$(echo "$CREATED" | python3 -c 'import json,sys; print(json.load(sys.stdin)["agentRuntimeId"])')
  RUNTIME_ARN=$(echo "$CREATED" | python3 -c 'import json,sys; print(json.load(sys.stdin)["agentRuntimeArn"])')
else
  echo "-- updating runtime ${RUNTIME_NAME} (${EXISTING_ID})"
  UPDATED=$(aws bedrock-agentcore-control update-agent-runtime \
    --agent-runtime-id "$EXISTING_ID" \
    --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"${IMAGE}\"}}" \
    --role-arn "$ROLE_ARN" \
    --network-configuration '{"networkMode":"PUBLIC"}' \
    --environment-variables "$ENV_VARS")
  RUNTIME_ID="$EXISTING_ID"
  RUNTIME_ARN=$(echo "$UPDATED" | python3 -c 'import json,sys; print(json.load(sys.stdin)["agentRuntimeArn"])')
fi

echo "-- waiting for READY (${RUNTIME_ID})"
for _ in $(seq 1 60); do
  STATUS=$(aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$RUNTIME_ID" --query 'status' --output text)
  [[ "$STATUS" == "READY" ]] && break
  [[ "$STATUS" == *FAILED* ]] && { echo "runtime entered $STATUS"; exit 1; }
  sleep 5
done
echo "-- runtime status: ${STATUS:-unknown}"

aws ssm put-parameter --name "${SSM_PREFIX}/runtime-arn" --value "$RUNTIME_ARN" --type String --overwrite >/dev/null
aws ssm put-parameter --name "${SSM_PREFIX}/runtime-image" --value "$IMAGE" --type String --overwrite >/dev/null
echo "== OK: ${RUNTIME_ARN} (image ${TAG}) =="
echo "   rollback: update-agent-runtime with a previous :tag from ECR"
