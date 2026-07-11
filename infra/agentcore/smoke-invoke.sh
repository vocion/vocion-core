#!/usr/bin/env bash
# Smoke-test the DEPLOYED AgentCore runtime: send a toolless invocation
# and assert the SSE stream ends with a `done` event carrying a response.
#
# Toolless on purpose: the tool endpoint (vocion-core) is not reachable
# from AWS until core itself is deployed, so the smoke proves the loop +
# model path (Bedrock) + streaming contract — the artifact's whole job.
#
# Usage: ENV=dev AWS_PROFILE=metacto REGION=us-west-2 bash infra/agentcore/smoke-invoke.sh
set -euo pipefail

ENV="${ENV:-dev}"
REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-metacto}"
aws() { command aws --region "$REGION" --profile "$PROFILE" "$@"; }

SSM_PREFIX="/vocion/agentcore/${ENV}"
RUNTIME_ARN=$(aws ssm get-parameter --name "${SSM_PREFIX}/runtime-arn" --query 'Parameter.Value' --output text)
SESSION="smoke-$(date +%s)-$(openssl rand -hex 8)"
OUT=$(mktemp)

PAYLOAD=$(cat <<'JSON'
{
  "version": 1,
  "agent": {
    "slug": "smoke",
    "name": "Smoke Test",
    "systemPrompt": "You are a smoke-test agent. Answer in one short sentence. Never use tools.",
    "excludeTools": []
  },
  "message": "Reply with exactly: VOCION RUNTIME OK",
  "tools": { "endpoint": "http://invalid.local/unused", "catalog": [], "claim": "smoke-no-claim" },
  "trace": { "orgId": "smoke", "userId": "smoke" }
}
JSON
)

echo "== smoke: invoking ${RUNTIME_ARN##*/} (session ${SESSION}) =="
aws bedrock-agentcore invoke-agent-runtime \
  --cli-binary-format raw-in-base64-out \
  --agent-runtime-arn "$RUNTIME_ARN" \
  --runtime-session-id "$SESSION" \
  --content-type 'application/json' \
  --accept 'text/event-stream' \
  --payload "$PAYLOAD" \
  "$OUT" >/dev/null

echo "-- stream tail:"
tail -c 600 "$OUT"; echo

if grep -q '"type": *"done"' "$OUT" && grep -qi 'VOCION RUNTIME OK' "$OUT"; then
  echo "== PASS: streamed done event with expected response =="
else
  echo "== FAIL: no done event / expected text in stream =="
  exit 1
fi
