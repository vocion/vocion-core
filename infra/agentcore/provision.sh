#!/usr/bin/env bash
# Provision the AWS foundation for the BYOA agent runtime (idempotent).
#
#   1. ECR repository for the runtime container image
#   2. Execution role the AgentCore Runtime assumes (model calls, logs, ECR pull)
#   3. AgentCore Memory store (short-term; consumed in Phase 5)
#   4. Outputs → SSM Parameter Store under /vocion/agentcore/<env>/
#
# Usage: ENV=dev AWS_PROFILE=metacto REGION=us-west-2 bash infra/agentcore/provision.sh
set -euo pipefail

ENV="${ENV:-dev}"
REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-metacto}"
aws() { command aws --region "$REGION" --profile "$PROFILE" "$@"; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="vocion-agent-runtime-${ENV}"
ROLE="VocionAgentRuntimeRole-${ENV}"
MEMORY_NAME="vocion_agent_memory_${ENV}"
SSM_PREFIX="/vocion/agentcore/${ENV}"

echo "== vocion agentcore provision · account=${ACCOUNT} region=${REGION} env=${ENV} =="

# ---------------------------------------------------------------- 1. ECR
if ! aws ecr describe-repositories --repository-names "$REPO" >/dev/null 2>&1; then
  echo "-- creating ECR repo $REPO"
  aws ecr create-repository --repository-name "$REPO" --image-scanning-configuration scanOnPush=true >/dev/null
else
  echo "-- ECR repo $REPO exists"
fi
REPO_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}"

# ---------------------------------------------------------------- 2. IAM role
TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "aws:SourceAccount": "${ACCOUNT}" } }
  }]
}
JSON
)
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "-- creating role $ROLE"
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" >/dev/null
else
  echo "-- role $ROLE exists (refreshing trust policy)"
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
fi

POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Models",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogGroups", "logs:DescribeLogStreams"],
      "Resource": "*"
    },
    {
      "Sid": "EcrPull",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
      "Resource": "*"
    },
    {
      "Sid": "Telemetry",
      "Effect": "Allow",
      "Action": ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "cloudwatch:PutMetricData"],
      "Resource": "*"
    },
    {
      "Sid": "Memory",
      "Effect": "Allow",
      "Action": ["bedrock-agentcore:CreateEvent", "bedrock-agentcore:ListEvents", "bedrock-agentcore:GetEvent", "bedrock-agentcore:RetrieveMemoryRecords", "bedrock-agentcore:GetMemoryRecord", "bedrock-agentcore:ListMemoryRecords"],
      "Resource": "*"
    }
  ]
}
JSON
)
aws iam put-role-policy --role-name "$ROLE" --policy-name runtime-permissions --policy-document "$POLICY"
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"
echo "-- role ready: $ROLE_ARN"

# ---------------------------------------------------------------- 3. Memory
MEMORY_ID=$(aws bedrock-agentcore-control list-memories \
  --query "memories[?starts_with(id, '${MEMORY_NAME}')].id | [0]" --output text 2>/dev/null || echo "None")
if [[ "$MEMORY_ID" == "None" || -z "$MEMORY_ID" ]]; then
  echo "-- creating Memory store $MEMORY_NAME (short-term only; strategies come in Phase 5)"
  MEMORY_ID=$(aws bedrock-agentcore-control create-memory \
    --name "$MEMORY_NAME" \
    --description "Vocion agent conversation memory (${ENV})" \
    --event-expiry-duration 30 \
    --query 'memory.id' --output text)
fi
echo "-- memory: $MEMORY_ID (waiting for ACTIVE)"
for _ in $(seq 1 30); do
  STATUS=$(aws bedrock-agentcore-control get-memory --memory-id "$MEMORY_ID" --query 'memory.status' --output text)
  [[ "$STATUS" == "ACTIVE" ]] && break
  [[ "$STATUS" == "FAILED" ]] && { echo "memory FAILED"; exit 1; }
  sleep 5
done
echo "-- memory status: ${STATUS:-unknown}"

# ---------------------------------------------------------------- 4. SSM
put() { aws ssm put-parameter --name "$1" --value "$2" --type String --overwrite >/dev/null; }
put "${SSM_PREFIX}/ecr-repo-uri" "$REPO_URI"
put "${SSM_PREFIX}/runtime-role-arn" "$ROLE_ARN"
put "${SSM_PREFIX}/memory-id" "$MEMORY_ID"
echo "-- SSM outputs written under ${SSM_PREFIX}/"

echo "== OK: provision complete. Next: bash infra/agentcore/deploy-runtime.sh =="
