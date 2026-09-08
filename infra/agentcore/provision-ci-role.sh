#!/usr/bin/env bash
# One-time: GitHub-OIDC deploy role, so a PARENT PROJECT's pipeline can deploy
# the agent runtime into its own AWS account.
#
# Core never deploys anything itself — it holds no AWS account. This script
# exists so that every client project gets the same one-command path to a CI
# deploy: run it once against that client's account, store the printed ARN as
# a secret in that client's repo, and its pipeline can then run
# deploy-runtime.sh + smoke-invoke.sh unattended.
#
# It creates two things:
#   1. The GitHub OIDC identity provider (account-wide, created if absent)
#   2. A deploy role assumable ONLY by the repo and ref you name, scoped to
#      exactly what deploy-runtime.sh + smoke-invoke.sh need.
#
# Deliberately manual and deliberately human: it creates federated trust
# between GitHub and an AWS account. Do it once per environment — SSM is
# namespaced per environment (/vocion/agentcore/<env>/), so two environments
# never share a runtime by accident.
#
# Usage:
#   GITHUB_REPO=Veerio-Life/veerio-vocion \
#   AWS_PROFILE=veerio REGION=us-west-2 \
#     bash infra/agentcore/provision-ci-role.sh
#
# Environment:
#   GITHUB_REPO   required, "<owner>/<repo>" of the project whose CI deploys.
#   GITHUB_REF    default refs/heads/main. The only ref admitted.
#   ROLE_NAME     default VocionAgentRuntimeDeployRole. Override when one
#                 account serves more than one project.
#   AWS_PROFILE   whose account to create the role in.
#   REGION        default us-west-2.
set -euo pipefail

REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-}"
aws() { if [ -n "$PROFILE" ]; then command aws --region "$REGION" --profile "$PROFILE" "$@"; else command aws --region "$REGION" "$@"; fi; }

# Named explicitly rather than guessed from the local git remote: this role is
# the trust boundary, and a wrong-but-plausible default here would admit
# someone else's CI to a client's AWS account.
GITHUB_REPO="${GITHUB_REPO:-}"
if [ -z "${GITHUB_REPO}" ]; then
  echo "ERROR: set GITHUB_REPO to the <owner>/<repo> whose CI should be allowed to deploy." >&2
  echo "       e.g. GITHUB_REPO=Veerio-Life/veerio-vocion AWS_PROFILE=veerio bash $0" >&2
  exit 2
fi
GITHUB_REF="${GITHUB_REF:-refs/heads/main}"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO_FILTER="repo:${GITHUB_REPO}:ref:${GITHUB_REF}"
ROLE="${ROLE_NAME:-VocionAgentRuntimeDeployRole}"
OIDC_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

echo "-- account ${ACCOUNT}, region ${REGION}"
echo "-- trusting ${REPO_FILTER}"

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
echo "   store as repo secret:"
echo "     gh secret set AWS_DEPLOY_ROLE_ARN --repo ${GITHUB_REPO} \\"
echo "       --body arn:aws:iam::${ACCOUNT}:role/${ROLE}"
