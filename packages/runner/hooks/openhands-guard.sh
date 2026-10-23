#!/usr/bin/env bash
# PreToolUse hook for the OpenHands engine (src/engines/openhands_driver.py): the same policy as
# Claude Code's hooks, by handing each OpenHands tool call to guard-bash.sh or guard-write.sh in the
# shape they read. Exit 2 blocks the call and returns stderr to the agent.
#
# OpenHands treats any exit other than 2 as "allow", so this hook fails CLOSED: anything it cannot
# read or map is blocked, and an unknown tool is blocked.
#   terminal                         -> guard-bash.sh   ({"tool_input":{"command":...}})
#   file_editor create/str_replace/
#               insert/undo_edit     -> guard-write.sh  ({"tool_input":{"file_path":...}})
#   file_editor view                 -> the Read denials in claude-settings.json (.env, keys, ...)
#   task_tracker, finish, think      -> allowed (no side effects outside the conversation)
here="$(cd "$(dirname "$0")" && pwd)"
trap 'echo "BLOCKED by runner policy: the guard could not check this call." >&2; exit 2' ERR
input=$(cat)
mapped=$(printf '%s' "$input" | python3 -c '
import json, sys
d = json.load(sys.stdin)
tool = d.get("tool_name") or ""
a = d.get("tool_input") or {}
if tool == "terminal":
    print("bash"); print(json.dumps({"tool_name": "Bash", "tool_input": {"command": a.get("command") or ""}}))
elif tool == "file_editor":
    cmd = a.get("command") or ""
    path = a.get("path") or ""
    if cmd == "view":
        print("read"); print(path)
    else:
        print("write"); print(json.dumps({"tool_name": "Write", "tool_input": {"file_path": path}}))
elif tool in ("task_tracker", "finish", "think"):
    print("allow"); print("")
else:
    print("unknown"); print(tool)
' 2>/dev/null)
kind=$(printf '%s\n' "$mapped" | sed -n 1p)
payload=$(printf '%s\n' "$mapped" | sed -n '2,$p')
case "$kind" in
  allow) exit 0 ;;
  bash) trap - ERR; exec "$here/guard-bash.sh" <<< "$payload" ;;
  write) trap - ERR; exec "$here/guard-write.sh" <<< "$payload" ;;
  read)
    case "$payload" in
      *.env|*.env.*|*/.env|*.pem|*.key|*/.ssh/*|*/.aws/*|*/.netrc|*/.npmrc|*/.git-credentials|*/.claude.json|*/.config/gh/*)
        echo "BLOCKED by runner policy: reading secrets, env files, keys or credential stores is forbidden." >&2; exit 2 ;;
    esac
    exit 0 ;;
  *) echo "BLOCKED by runner policy: the tool '$payload' is not one this runner allows." >&2; exit 2 ;;
esac
