#!/usr/bin/env bash
# PostToolUse hook: one JSON line per tool call, appended to the run's tool ledger and echoed to the
# runner log so the container's log shows what the agent did.
LEDGER="${RUNNER_TOOL_LEDGER:-/workspace/logs/tools.jsonl}"
mkdir -p "$(dirname "$LEDGER")" 2>/dev/null
HOOK_INPUT="$(cat)" LEDGER_FILE="$LEDGER" python3 -c '
import json,sys,time,os
try: d=json.loads(os.environ["HOOK_INPUT"])
except Exception: sys.exit(0)
ti=d.get("tool_input") or {}
brief=ti.get("command") or ti.get("file_path") or ti.get("pattern") or ti.get("description") or ti.get("prompt") or ""
rec={"ts":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"phase":"tool","run":os.environ.get("RUNNER_RUN_ID"),
     "tool":d.get("tool_name"),"input":str(brief)[:200]}
line=json.dumps(rec)
open(os.environ["LEDGER_FILE"],"a").write(line+"\n")
'
exit 0
