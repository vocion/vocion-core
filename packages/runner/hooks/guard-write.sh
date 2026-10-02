#!/usr/bin/env bash
# PreToolUse hook for Write/Edit/MultiEdit/NotebookEdit: secrets and the files a person owns are off
# limits, and every write stays inside the repository. The plan's allowed_paths are scope, not a
# fence: the runner sets RUNNER_ALLOWED_PATHS to ["**"]. RUNNER_HUMAN_OWNED is the repository's own
# list (the contract's human_owned, from the repo record), beside the fixed one below.
input=$(cat)
path=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("notebook_path") or "")' 2>/dev/null)
[ -n "$path" ] || exit 0
case "$path" in
  *.env|*.env.*|*/.env|*.pem|*.key|*/.ssh/*|*/.aws/*|*/.netrc|*/.npmrc|*/.git-credentials|*/.claude.json)
    echo "BLOCKED: writing secrets, env files or credential stores is forbidden." >&2; exit 2 ;;
  */.git/*|*/.github/workflows/*)
    echo "BLOCKED: .git and CI workflows are human-owned." >&2; exit 2 ;;
esac
# The repository's own list, before the scratch areas: a file a person owns is theirs wherever
# the checkout lives.
if [ -n "${RUNNER_HUMAN_OWNED:-}" ] && [ "${RUNNER_HUMAN_OWNED}" != "[]" ]; then
  if RUNNER_CHECK_PATH="$path" RUNNER_ALLOWED_PATHS="$RUNNER_HUMAN_OWNED" "$(dirname "$0")/path-allowed.sh"; then
    echo "BLOCKED: '$path' is one this repository says a person owns." >&2
    exit 2
  fi
fi
case "$path" in
  /tmp/*|/workspace/scratch/*|"$HOME"/.claude/*|/home/runner/.claude/*)
    exit 0 ;;
esac
if [ -n "${RUNNER_ALLOWED_PATHS:-}" ]; then
  if ! RUNNER_CHECK_PATH="$path" "$(dirname "$0")/path-allowed.sh"; then
    echo "BLOCKED: '$path' is outside the repository. Temporary files go in /workspace/scratch." >&2
    exit 2
  fi
fi
exit 0
