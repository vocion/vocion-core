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
PROFILE="${AWS_PROFILE:-}"
# Local: uses the AWS_PROFILE you export (e.g. metacto). CI: no profile —
# ambient OIDC credentials from configure-aws-credentials.
aws() { if [ -n "$PROFILE" ]; then command aws --region "$REGION" --profile "$PROFILE" "$@"; else command aws --region "$REGION" "$@"; fi; }

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
# Tracing. On by default; export OBSERVABILITY=false to deploy a runtime that
# emits nothing. What each variable does:
#
#   AGENT_OBSERVABILITY_ENABLED  the switch AWS's OpenTelemetry distro reads.
#       With it on, the distro exports every span rather than a sample, copies
#       `session.id` out of baggage onto each span, and turns on the GenAI span
#       processing that AgentCore Evaluations needs to read a trace.
#   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT  where the spans go. The distro only
#       uses its X-Ray exporter when this exactly matches
#       https://xray.<region>.amazonaws.com/v1/traces — a trailing slash or a
#       different host silently falls back to a plain OTLP exporter that has no
#       AWS credentials, and the spans go nowhere.
#   OTEL_EXPORTER_OTLP_TRACES_PROTOCOL  http/protobuf is the only protocol that
#       endpoint accepts; it speaks HTTP, never gRPC.
#   OTEL_LOGS_EXPORTER / OTEL_METRICS_EXPORTER = none  we export traces, not
#       logs or metrics. Left unset, the distro warns on every start about
#       missing log-group headers, and AWS's own guidance is to turn metrics off
#       here so Transaction Search is not billed twice.
#   OTEL_RESOURCE_ATTRIBUTES  the name this runtime appears under in the GenAI
#       Observability console.
#
# Spans reach CloudWatch Logs (the `aws/spans` group that batch evaluation
# reads) only if Transaction Search is on in this region — provision.sh turns
# it on, and it is billed per span ingested.
OBSERVABILITY="${OBSERVABILITY:-true}"
ENV_VARS=$(python3 - "$REGION" "$RUNTIME_NAME" "$OBSERVABILITY" <<'PYENV'
import json, sys

region, runtime_name, observability = sys.argv[1], sys.argv[2], sys.argv[3]
env = {"VOCION_MODEL_PROVIDER": "bedrock", "AWS_REGION": region}
if observability.lower() == "true":
    env.update({
        "AGENT_OBSERVABILITY_ENABLED": "true",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT": f"https://xray.{region}.amazonaws.com/v1/traces",
        "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL": "http/protobuf",
        "OTEL_TRACES_EXPORTER": "otlp",
        "OTEL_LOGS_EXPORTER": "none",
        "OTEL_METRICS_EXPORTER": "none",
        "OTEL_RESOURCE_ATTRIBUTES": f"service.name={runtime_name}",
    })
print(json.dumps(env))
PYENV
)
echo "-- observability: ${OBSERVABILITY}"
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
