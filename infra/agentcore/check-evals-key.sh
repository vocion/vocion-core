#!/usr/bin/env bash
# Check that the AWS key a workspace stores for AgentCore Evaluations can make
# every call Vocion's eval code makes — before an eval run finds out.
#
# Why this exists: eval calls are signed with the workspace's own key
# (Dashboard > API credentials), never with the box's instance role. A key
# missing one action does not fail the run. It degrades it quietly: "Could not
# copy these cases to AgentCore" (no CreateDataset), "Some evaluators this
# dataset declares could not be set up" (no CreateEvaluator), and the scores
# come back missing those checks. Each gap used to surface one eval run at a
# time. This finds all of them at once, for free: it asks IAM's policy
# simulator, which makes no AgentCore call and costs nothing.
#
# Run it with an operator profile that may call iam:SimulatePrincipalPolicy,
# not with the workspace key itself — that key has no IAM permissions and
# should not get any.
#
# Usage:
#   PRINCIPAL_ARN=arn:aws:iam::123456789012:user/my-evals-key \
#   ENV=dev AWS_PROFILE=my-operator REGION=us-west-2 \
#   bash infra/agentcore/check-evals-key.sh
#
#   Add --print-policy to print the IAM policy that grants exactly these
#   actions instead of checking. Attach it to the key's user or role through
#   your own IaC.
#
# Exit status: 0 when every action is allowed, 1 when any is denied, 2 on a
# usage or lookup error.
set -euo pipefail

ENV="${ENV:-dev}"
REGION="${REGION:-us-west-2}"
PROFILE="${AWS_PROFILE:-}"
PRINCIPAL_ARN="${PRINCIPAL_ARN:-}"
MODE="check"
if [ "${1:-}" = "--print-policy" ]; then
  MODE="print-policy"
fi

# Every AgentCore call the eval code makes, as "<action> <resource>".
#
# The resource is "*" where AWS's service authorization reference gives the
# action no resource type (the Create*, Start* and Evaluate calls below): scoped
# to an ARN, those never match and stay denied. Everything else is scoped to
# this account's resources of that type. {Region}, {Account} and
# {EvalExecutionRoleArn} are filled in at run time.
#
# packages/core/src/services/evals/providers/evalsKeyPermissions.test.ts fails
# when the eval code starts sending a command this list does not name, so a
# new call cannot ship without its permission. Keep the markers.
#
# Evaluate stays on "*" because it authorizes against the evaluator, and the
# built-ins (Builtin.Correctness, ...) are named by id, not by an ARN in the
# customer's account.
read_required_actions() {
  # BEGIN REQUIRED ACTIONS
  cat <<'ACTIONS'
bedrock-agentcore:Evaluate *
bedrock-agentcore:CreateDataset *
bedrock-agentcore:GetDataset arn:aws:bedrock-agentcore:{Region}:{Account}:dataset/*
bedrock-agentcore:CreateDatasetVersion arn:aws:bedrock-agentcore:{Region}:{Account}:dataset/*
bedrock-agentcore:ListDatasetExamples arn:aws:bedrock-agentcore:{Region}:{Account}:dataset/*
bedrock-agentcore:AddDatasetExamples arn:aws:bedrock-agentcore:{Region}:{Account}:dataset/*
bedrock-agentcore:UpdateDatasetExamples arn:aws:bedrock-agentcore:{Region}:{Account}:dataset/*
bedrock-agentcore:DeleteDatasetExamples arn:aws:bedrock-agentcore:{Region}:{Account}:dataset/*
bedrock-agentcore:CreateEvaluator *
bedrock-agentcore:UpdateEvaluator arn:aws:bedrock-agentcore:{Region}:{Account}:evaluator/*
bedrock-agentcore:StartBatchEvaluation *
bedrock-agentcore:GetBatchEvaluation arn:aws:bedrock-agentcore:{Region}:{Account}:batch-evaluate/*
bedrock-agentcore:CreateOnlineEvaluationConfig *
bedrock-agentcore:GetOnlineEvaluationConfig arn:aws:bedrock-agentcore:{Region}:{Account}:online-evaluation-config/*
bedrock-agentcore:UpdateOnlineEvaluationConfig arn:aws:bedrock-agentcore:{Region}:{Account}:online-evaluation-config/*
bedrock-agentcore:DeleteOnlineEvaluationConfig arn:aws:bedrock-agentcore:{Region}:{Account}:online-evaluation-config/*
iam:PassRole {EvalExecutionRoleArn}
ACTIONS
  # END REQUIRED ACTIONS
}

aws_call() {
  if [ -n "$PROFILE" ]; then
    command aws --region "$REGION" --profile "$PROFILE" "$@"
  else
    command aws --region "$REGION" "$@"
  fi
}

fail_usage() {
  echo "check-evals-key: $*" >&2
  exit 2
}

# Replace the {Region}, {Account} and {EvalExecutionRoleArn} placeholders.
fill_placeholders() {
  local resource="$1" account="$2" eval_role_arn="$3"
  resource="${resource//\{Region\}/$REGION}"
  resource="${resource//\{Account\}/$account}"
  resource="${resource//\{EvalExecutionRoleArn\}/$eval_role_arn}"
  echo "$resource"
}

# IAM's simulator matches a resource ARN, not a pattern, so a scoped entry is
# checked against one concrete example of it.
example_resource_for() {
  local resource="$1"
  echo "${resource/%\*/vocion-preflight}"
}

# Print one statement per distinct resource, as a policy document.
print_policy() {
  local account="$1" eval_role_arn="$2"
  local lines resource first_statement=1
  lines="$(read_required_actions)"
  echo '{'
  echo '  "Version": "2012-10-17",'
  echo '  "Statement": ['
  while read -r resource; do
    local actions
    actions="$(echo "$lines" | awk -v r="$resource" '$2 == r { printf "%s\"%s\"", (n++ ? ", " : ""), $1 }')"
    [ "$first_statement" -eq 1 ] || echo '    ,'
    first_statement=0
    local filled
    filled="$(fill_placeholders "$resource" "$account" "$eval_role_arn")"
    if [ "$resource" = "{EvalExecutionRoleArn}" ]; then
      echo "    { \"Effect\": \"Allow\", \"Action\": [${actions}], \"Resource\": \"${filled}\","
      echo '      "Condition": { "StringEquals": { "iam:PassedToService": "bedrock-agentcore.amazonaws.com" } } }'
    else
      echo "    { \"Effect\": \"Allow\", \"Action\": [${actions}], \"Resource\": \"${filled}\" }"
    fi
  done < <(echo "$lines" | awk '{ print $2 }' | awk '!seen[$0]++')
  echo '  ]'
  echo '}'
}

# Simulate one action against one resource; print the decision.
simulate_one() {
  local action="$1" resource="$2"
  local context_args=()
  if [ "$action" = "iam:PassRole" ]; then
    context_args=(--context-entries "ContextKeyName=iam:PassedToService,ContextKeyValues=bedrock-agentcore.amazonaws.com,ContextKeyType=string")
  fi
  aws_call iam simulate-principal-policy \
    --policy-source-arn "$PRINCIPAL_ARN" \
    --action-names "$action" \
    --resource-arns "$resource" \
    "${context_args[@]+"${context_args[@]}"}" \
    --query 'EvaluationResults[0].EvalDecision' --output text </dev/null
}

run_check() {
  local account="$1" eval_role_arn="$2"
  local action resource filled decision denied=0
  echo "== check-evals-key: ${PRINCIPAL_ARN} (${ENV}, ${REGION}) =="
  while read -r action resource; do
    filled="$(fill_placeholders "$resource" "$account" "$eval_role_arn")"
    if [ "$filled" != "*" ]; then
      filled="$(example_resource_for "$filled")"
    fi
    decision="$(simulate_one "$action" "$filled")"
    if [ "$decision" = "allowed" ]; then
      printf '  ok      %s\n' "$action"
    else
      printf '  DENIED  %s on %s (%s)\n' "$action" "$filled" "$decision"
      denied=$((denied + 1))
    fi
  done < <(read_required_actions)

  if [ "$denied" -gt 0 ]; then
    echo "== ${denied} action(s) denied. Grant them with: bash infra/agentcore/check-evals-key.sh --print-policy =="
    return 1
  fi
  echo "== every eval action allowed =="
}

main() {
  local account eval_role_arn
  account="$(aws_call sts get-caller-identity --query Account --output text)" \
    || fail_usage "could not read the caller's account — is AWS_PROFILE set?"
  eval_role_arn="$(aws_call ssm get-parameter --name "/vocion/agentcore/${ENV}/eval-execution-role-arn" --query 'Parameter.Value' --output text 2>/dev/null)" \
    || fail_usage "no /vocion/agentcore/${ENV}/eval-execution-role-arn in SSM — run infra/agentcore/provision.sh for ${ENV} first"

  if [ "$MODE" = "print-policy" ]; then
    print_policy "$account" "$eval_role_arn"
    return 0
  fi

  [ -n "$PRINCIPAL_ARN" ] || fail_usage "set PRINCIPAL_ARN to the IAM user or role behind the workspace's AWS key"
  case "$PRINCIPAL_ARN" in
    "arn:aws:iam::${account}:"*) ;;
    *) fail_usage "PRINCIPAL_ARN is not in account ${account}, the account this profile and the eval role belong to" ;;
  esac
  run_check "$account" "$eval_role_arn"
}

main "$@"
