#!/usr/bin/env bash
# Provision the AWS foundation for the BYOA agent runtime (idempotent).
#
#   1. ECR repository for the runtime container image
#   2. Execution role the AgentCore Runtime assumes (model calls, logs, ECR pull)
#   3. AgentCore Memory store (short-term; consumed in Phase 5)
#   4. CloudWatch Transaction Search, so agent spans can reach CloudWatch Logs
#   5. Outputs → SSM Parameter Store under /vocion/agentcore/<env>/
#
# Usage: ENV=dev AWS_PROFILE=metacto REGION=us-west-2 bash infra/agentcore/provision.sh
set -euo pipefail

ENV="${ENV:-dev}"
REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-}"
# Local: uses the AWS_PROFILE you export (e.g. metacto). CI: no profile —
# ambient OIDC credentials from configure-aws-credentials.
aws() { if [ -n "$PROFILE" ]; then command aws --region "$REGION" --profile "$PROFILE" "$@"; else command aws --region "$REGION" "$@"; fi; }

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

# Long-term extraction strategies (facts + preferences, per-actor
# namespaces). Idempotent: only added when absent.
HAVE_STRATEGIES=$(aws bedrock-agentcore-control get-memory --memory-id "$MEMORY_ID" \
  --query "length(memory.strategies[?name=='vocion_facts'])" --output text 2>/dev/null || echo 0)
if [[ "$HAVE_STRATEGIES" == "0" ]]; then
  echo "-- adding long-term memory strategies (vocion_facts, vocion_preferences)"
  aws bedrock-agentcore-control update-memory --memory-id "$MEMORY_ID" --memory-strategies '{
    "addMemoryStrategies": [
      { "semanticMemoryStrategy": { "name": "vocion_facts", "description": "Durable facts stated by or about the user (companies, deals, people, constraints).", "namespaces": ["/facts/{actorId}"] } },
      { "userPreferenceMemoryStrategy": { "name": "vocion_preferences", "description": "How this user likes to work: formats, tone, length, channels, cadences.", "namespaces": ["/preferences/{actorId}"] } }
    ]
  }' >/dev/null
  for _ in $(seq 1 24); do
    S=$(aws bedrock-agentcore-control get-memory --memory-id "$MEMORY_ID" --query 'memory.status' --output text)
    [[ "$S" == "ACTIVE" ]] && break
    sleep 5
  done
else
  echo "-- long-term memory strategies present"
fi

# ------------------------------------------- 4. CloudWatch Transaction Search
#
# Without this, AgentCore cannot deliver agent spans to CloudWatch Logs, and
# without those spans there is nothing for a batch or online evaluation to
# read — the scores would only ever exist inside Vocion. Two parts: a resource
# policy letting X-Ray write spans into the log groups, and flipping the
# account's trace segment destination.
#
# Account-and-region wide, not per environment: dev and production in the same
# region share one setting, so this is written to be safe to run repeatedly.
#
# **This starts a bill.** Span ingestion into CloudWatch Logs is charged by
# volume, on this account. The sampling rule below decides how much.

SPAN_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "TransactionSearchXRayAccess",
    "Effect": "Allow",
    "Principal": { "Service": "xray.amazonaws.com" },
    "Action": "logs:PutLogEvents",
    "Resource": [
      "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:aws/spans:*",
      "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/application-signals/data:*",
      "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/bedrock-agentcore/runtimes/*"
    ],
    "Condition": {
      "ArnLike": { "aws:SourceArn": "arn:aws:xray:${REGION}:${ACCOUNT}:*" },
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT}" }
    }
  }]
}
JSON
)
aws logs put-resource-policy \
  --policy-name VocionAgentCoreSpanDelivery \
  --policy-document "$SPAN_POLICY" >/dev/null
echo "-- span delivery resource policy in place"

# The destination cannot be changed while a previous change is still settling,
# and re-sending the value it already holds is refused as well, so both states
# are checked rather than assumed.
TRACE_DEST=$(aws xray get-trace-segment-destination --query 'Destination' --output text 2>/dev/null || echo UNKNOWN)
TRACE_STATUS=$(aws xray get-trace-segment-destination --query 'Status' --output text 2>/dev/null || echo UNKNOWN)
if [ "$TRACE_DEST" = "CloudWatchLogs" ]; then
  echo "-- transaction search already sending spans to CloudWatch Logs (${TRACE_STATUS})"
elif [ "$TRACE_STATUS" = "PENDING" ]; then
  echo "-- transaction search is mid-change (${TRACE_DEST}, PENDING); leaving it alone"
else
  echo "-- enabling transaction search (spans → CloudWatch Logs)"
  aws xray update-trace-segment-destination --destination CloudWatchLogs >/dev/null
fi

# How much of the traffic gets indexed. 1% is AWS's default and is plenty for
# evaluation, which reads whole sessions by id rather than sampling. Raising it
# raises the bill; it is set explicitly so nobody has to guess what it is.
aws xray update-indexing-rule \
  --name Default \
  --rule '{"Probabilistic": {"DesiredSamplingPercentage": 1.0}}' >/dev/null 2>&1 \
  || echo "-- could not set the indexing rule; leaving whatever is configured"

# ------------------------------------------ 5. online evaluation role
# The role AWS assumes to run continuous evaluation of live traffic.
#
# Online evaluation is a standing configuration: AWS reads a sample of real
# sessions out of the spans log group, scores them, and writes the results
# back. It does that as this role, not as the caller, so the role has to exist
# before a configuration can be created.
#
# Creating the role costs nothing and starts nothing. It is a prerequisite, not
# a switch — the configuration itself is created switched off, and only starts
# sampling when somebody enables it. See docs/guides/agentcore-evals.md.
#
# Read access to the spans, write access to the results, and nothing else.
EVAL_ROLE_NAME="VocionAgentCoreEvaluationExecution"
EVAL_TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "bedrock-agentcore.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": {
      "StringEquals": { "aws:SourceAccount": "${ACCOUNT}" },
      "ArnLike": { "aws:SourceArn": "arn:aws:bedrock-agentcore:${REGION}:${ACCOUNT}:*" }
    }
  }]
}
JSON
)
if aws iam get-role --role-name "$EVAL_ROLE_NAME" >/dev/null 2>&1; then
  echo "-- evaluation execution role already exists"
  aws iam update-assume-role-policy --role-name "$EVAL_ROLE_NAME" \
    --policy-document "$EVAL_TRUST" >/dev/null
else
  echo "-- creating evaluation execution role ${EVAL_ROLE_NAME}"
  aws iam create-role --role-name "$EVAL_ROLE_NAME" \
    --description "Read agent spans and write evaluation results (Vocion online evaluation)" \
    --assume-role-policy-document "$EVAL_TRUST" >/dev/null
fi

# Scoped as tightly as the service allows, because this role is assumed by AWS
# itself and nobody here is watching what it does with it.
#
# Two statements read logs rather than one. StartQuery is the gate: it names the
# log group, so that is where the scoping belongs. GetQueryResults and StopQuery
# take a query id, not a log group, and DescribeLogGroups is a list call — those
# three are not known to accept a log-group ARN, and a policy that scopes them
# anyway would deny them at runtime and break evaluation for a reason nothing
# would explain. Granting them broadly costs little: they can only return a
# query this role already started, which StartQuery above controls.
EVAL_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadAgentSpans",
      "Effect": "Allow",
      "Action": [
        "logs:StartQuery",
        "logs:GetLogEvents", "logs:FilterLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:aws/spans:*",
        "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/bedrock-agentcore/runtimes/*"
      ]
    },
    {
      "Sid": "ReadOwnQueryResults",
      "Effect": "Allow",
      "Action": ["logs:GetQueryResults", "logs:StopQuery", "logs:DescribeLogGroups"],
      "Resource": "*"
    },
    {
      "Sid": "WriteEvaluationResults",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT}:log-group:/aws/bedrock-agentcore/evaluations/*"
    },
    {
      "Sid": "PublishEvaluationMetrics",
      "Effect": "Allow",
      "Action": "cloudwatch:PutMetricData",
      "Resource": "*",
      "Condition": {
        "StringEquals": { "cloudwatch:namespace": "Bedrock-AgentCore/Evaluations" }
      }
    },
    {
      "Sid": "InvokeJudgeModels",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/*",
        "arn:aws:bedrock:${REGION}:${ACCOUNT}:inference-profile/*"
      ]
    }
  ]
}
JSON
)
aws iam put-role-policy --role-name "$EVAL_ROLE_NAME" \
  --policy-name VocionEvaluationExecution \
  --policy-document "$EVAL_POLICY" >/dev/null
EVAL_ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${EVAL_ROLE_NAME}"
echo "-- evaluation execution role ready: ${EVAL_ROLE_ARN}"

# ---------------------------------------------------------------- 6. SSM
put() { aws ssm put-parameter --name "$1" --value "$2" --type String --overwrite >/dev/null; }
put "${SSM_PREFIX}/ecr-repo-uri" "$REPO_URI"
put "${SSM_PREFIX}/runtime-role-arn" "$ROLE_ARN"
put "${SSM_PREFIX}/memory-id" "$MEMORY_ID"
put "${SSM_PREFIX}/eval-execution-role-arn" "$EVAL_ROLE_ARN"
echo "-- SSM outputs written under ${SSM_PREFIX}/"

echo "== OK: provision complete. Next: bash infra/agentcore/deploy-runtime.sh =="
