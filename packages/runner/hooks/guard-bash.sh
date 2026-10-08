#!/usr/bin/env bash
# PreToolUse hook for Bash inside the Vocion runner. Deterministic policy, independent of the prompt.
# Reads the tool call as JSON on stdin; exit 2 blocks the call and returns stderr to the agent.
#
# Environment (set by runner.mjs when it spawns claude):
#   RUNNER_ALLOWED_PATHS   JSON array of globs relative to the repo root (["**"]: the repository)
#   RUNNER_REPO            absolute path of the repo checkout
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
[ -n "$cmd" ] || exit 0

deny() { echo "BLOCKED by runner policy: $1" >&2; echo "Command: $cmd" >&2; exit 2; }

# 1. Git: the worker commits, pushes and opens the PR. The agent only edits files.
echo "$cmd" | grep -Eq '\bgit +(push|commit|merge|rebase|cherry-pick|reset +--hard|checkout +--|restore|clean|stash|tag|branch +-[dDm]|remote +(add|set-url|remove))\b' \
  && deny "git write operations are the worker's job. Edit files; the worker verifies, commits, pushes and opens the PR."
echo "$cmd" | grep -Eq '\bgit +(checkout|switch) +[^|;&]*\b(main|dev|master|production)\b' && deny "switching to main/dev is forbidden; stay on the factory branch."
echo "$cmd" | grep -Eq '\bgh +(pr +(merge|close|edit|create|review)|repo +(delete|edit)|release|api +[^|;&]*(-X *(POST|PUT|PATCH|DELETE)|--method *(POST|PUT|PATCH|DELETE)|-f |-F ))' \
  && deny "GitHub writes are the worker's job (or a human's). Read-only gh is fine."

# 2. Nothing destructive.
echo "$cmd" | grep -Eq '(^|[;&|] *)rm +-[a-zA-Z]*[rR][a-zA-Z]* +(/|~|\$HOME|\.\.|/workspace|\.git)( |$|/)' && deny "recursive delete of / ~ .. /workspace or .git is forbidden."
echo "$cmd" | grep -Eq '\brm +-[a-zA-Z]*[rR]' && deny "recursive delete is forbidden inside a runner task. Delete single files if the task needs it."
echo "$cmd" | grep -Eq 'DROP (DATABASE|TABLE)|TRUNCATE ' && deny "destructive SQL is forbidden."
echo "$cmd" | grep -Eq 'docker +(compose[^|;&]* down[^|;&]* -v|volume +rm|system +prune)' && deny "wiping Docker volumes is forbidden."
echo "$cmd" | grep -Eq '\b(mkfs|dd +if=|shutdown|reboot|kill +-9 +-1|killall)\b' && deny "host-level destructive commands are forbidden."
echo "$cmd" | grep -Eq '\bchmod +(-R +)?[0-7]*777\b|\bchown +-R' && deny "recursive permission changes are forbidden."

# 3. Never touch secrets or credentials.
echo "$cmd" | grep -Eq '(^|[^A-Za-z0-9_])(cat|echo|printf|sed|grep|rg|less|more|head|tail|awk|cut|xxd|base64|strings|source|\.) +[^|;&]*(\.env(\.[A-Za-z0-9_-]+)?\b|\.aws/|\.ssh/|\.pem\b|\.netrc|\.npmrc|\.git-credentials|\.claude\.json|\.config/gh)' \
  && deny "reading secrets, env files, keys or credential stores is forbidden. Secrets are injected outside the agent."
echo "$cmd" | grep -Eq '\b(env|printenv|set)\b *($|[|;&>])' && deny "dumping the environment is forbidden (it holds credentials). Read one variable by name if you must."
echo "$cmd" | grep -Eq '\$\{?(ANTHROPIC_API_KEY|GITHUB_TOKEN|GH_TOKEN|VOCION_TOKEN|VOCION_RUNNER_TOKEN|VOCION_RUN_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)\b' && deny "referencing credential variables is forbidden."
echo "$cmd" | grep -Eq '\baws +(configure|sso|login)\b|AWS_ACCESS_KEY_ID=|AWS_SECRET_ACCESS_KEY=' && deny "AWS credential changes are forbidden."

# 4. No mutating AWS, no deploys, no publishing.
echo "$cmd" | grep -Eq '\baws\b[^|;&]*\b(create|put|update|delete|terminate|deregister|modify|remove|stop|start|reboot|attach|detach|associate|authorize|revoke|run-instances|invoke|publish|register|deploy|tag|untag|enable|disable|set|add|batch-write|restore|copy|import|export|execute|send|cancel|purge|reset|rotate|assume-role)[a-z-]*\b' \
  && deny "AWS mutating commands are human-only. describe-*, list-*, get-* are fine."
echo "$cmd" | grep -Eq '\bnpm +publish\b|\b(vercel|netlify|wrangler|cdk|sst|serverless|sls|amplify|copilot|sam) +(deploy|destroy|remove|publish)\b|\b(terraform|tofu) +(apply|destroy|import)\b' \
  && deny "deploying and publishing are human-only (or CI on a merged PR)."

# 5. Outbound writes: only GitHub reads are expected. POST/PUT/DELETE to anything is denied.
echo "$cmd" | grep -Eq '\bcurl\b[^|;&]*(-X *(POST|PUT|PATCH|DELETE)|--data|-d |--form|-F |--upload-file|-T )' && deny "outbound writes from the agent are forbidden. Results land through the worker's PR."
echo "$cmd" | grep -Eq '\bwget\b[^|;&]*(--post-data|--post-file|--method=(POST|PUT|DELETE))' && deny "outbound writes from the agent are forbidden."

# 6. Path guard, best effort: shell redirections and in-place editors stay inside the repository.
#    (The Write/Edit tools have their own hook; the deterministic verify step catches anything that slips past.)
if [ -n "${RUNNER_ALLOWED_PATHS:-}" ]; then
  targets=$(printf '%s' "$cmd" | python3 -c '
import re,sys
cmd=sys.stdin.read()
out=[]
for m in re.finditer(r"(?:^|[^<>])>{1,2}\s*([^\s;&|<>]+)", cmd): out.append(m.group(1))
for m in re.finditer(r"\btee\s+(?:-a\s+)?([^\s;&|<>-][^\s;&|<>]*)", cmd): out.append(m.group(1))
for m in re.finditer(r"\bsed\s+-i[^\s]*\s+(?:-e\s+)?(?:\x27[^\x27]*\x27|\"[^\"]*\"|\S+)\s+([^\s;&|<>]+)", cmd): out.append(m.group(1))
for m in re.finditer(r"\b(?:touch|mkdir(?:\s+-p)?|mv\s+\S+|cp\s+(?:-r\s+)?\S+|rm(?:\s+-f)?)\s+([^\s;&|<>-][^\s;&|<>]*)", cmd): out.append(m.group(1))
print("\n".join(t for t in out if t not in ("/dev/null","/dev/stderr","/dev/stdout","&1","&2")))')
  if [ -n "$targets" ]; then
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      case "$t" in /tmp/*|/dev/*|"$HOME"/.claude/*|/home/runner/.claude/*|/workspace/scratch/*) continue ;; esac
      if ! RUNNER_CHECK_PATH="$t" "$(dirname "$0")/path-allowed.sh"; then
        deny "'$t' is outside the repository. Use /workspace/scratch for temporary files."
      fi
    done <<< "$targets"
  fi
fi
exit 0
