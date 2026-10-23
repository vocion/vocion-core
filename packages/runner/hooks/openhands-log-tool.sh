#!/usr/bin/env bash
# PostToolUse hook for the OpenHands engine: the tool ledger line log-tool.sh writes, from an
# OpenHands tool call (terminal is Bash, file_editor is Read/Write/Edit by its command).
input=$(cat)
printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
tool = d.get("tool_name") or ""
a = d.get("tool_input") or {}
names = {"view": "Read", "create": "Write"}
if tool == "terminal":
    out = {"tool_name": "Bash", "tool_input": {"command": a.get("command") or ""}}
elif tool == "file_editor":
    out = {"tool_name": names.get(a.get("command"), "Edit"), "tool_input": {"file_path": a.get("path") or ""}}
else:
    out = {"tool_name": tool, "tool_input": {}}
print(json.dumps(out))
' | "$(dirname "$0")/log-tool.sh"
exit 0
