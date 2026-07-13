#!/usr/bin/env bash
# One-time: GitHub-OIDC deploy role for the agent-runtime CI pipeline.
#
#   1. GitHub OIDC identity provider (account-wide, created if absent)
#   2. VocionAgentRuntimeDeployRole — assumable ONLY by
#      vocion/vocion-core@refs/heads/main via OIDC; scoped to what
#      deploy-runtime.sh + smoke-invoke.sh need.
#
# Prints the role ARN to store as the AWS_DEPLOY_ROLE_ARN repo secret.
# Usage: AWS_PROFILE=metacto REGION=us-west-2 bash infra/agentcore/provision-ci-role.sh
set -euo pipefail

REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-}"
aws() { if [ -n "$PROFILE" ]; then command aws --region "$REGION" --profile "$PROFILE" "$@"; else command aws --region "$REGION" "$@"; fi; }

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO_FILTER="repo:vocion/vocion-core:ref:refs/heads/main"
ROLE="VocionAgentRuntimeDeployRole"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

# ---------------------------------------------------------------- 1. OIDC provider
if ! aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1; then
  echo "-- creating GitHub OIDC provider"
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
else
  echo "-- GitHub OIDC provider exists"
fi

# ---------------------------------------------------------------- 2. deploy role
TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "${REPO_FILTER}" }
    }
  }]
}
JSON
)
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "-- creating role $ROLE"
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document "$TRUST" >/dev/null
else
  echo "-- role $ROLE exists (refreshing trust)"
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document "$TRUST"
fi

POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrPush",
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability", "ecr:PutImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:DescribeRepositories"],
      "Resource": "*"
    },
    {
      "Sid": "AgentCoreDeploy",
      "Effect": "Allow",
      "Action": ["bedrock-agentcore:CreateAgentRuntime", "bedrock-agentcore:UpdateAgentRuntime", "bedrock-agentcore:GetAgentRuntime", "bedrock-agentcore:ListAgentRuntimes", "bedrock-agentcore:InvokeAgentRuntime"],
      "Resource": "*"
    },
    {
      "Sid": "PassRuntimeRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::${ACCOUNT}:role/VocionAgentRuntimeRole-*",
      "Condition": { "StringEquals": { "iam:PassedToService": "bedrock-agentcore.amazonaws.com" } }
    },
    {
      "Sid": "SsmParams",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter", "ssm:PutParameter"],
      "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/vocion/agentcore/*"
    },
    {
      "Sid": "Identity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
JSON
)
aws iam put-role-policy --role-name "$ROLE" --policy-name deploy-permissions --policy-document "$POLICY"

echo "== OK: arn:aws:iam::${ACCOUNT}:role/${ROLE}"
echo "   store as repo secret: gh secret set AWS_DEPLOY_ROLE_ARN --repo vocion/vocion-core"
