#!/usr/bin/env bash
# Exit 0 when RUNNER_CHECK_PATH is inside one of RUNNER_ALLOWED_PATHS (globs relative to RUNNER_REPO).
# Glob rules: ** matches across directories, * within one segment, ? one character.
# A path outside the repo is never allowed. An empty RUNNER_ALLOWED_PATHS allows nothing.
python3 - <<'PY'
import json, os, re, sys
p = os.environ.get("RUNNER_CHECK_PATH", "")
repo = os.path.realpath(os.environ.get("RUNNER_REPO") or os.getcwd())
try:
    globs = json.loads(os.environ.get("RUNNER_ALLOWED_PATHS") or "[]")
except Exception:
    globs = []
if not p:
    sys.exit(1)
ap = os.path.realpath(os.path.join(repo, p)) if not os.path.isabs(p) else os.path.realpath(p)
if ap != repo and not ap.startswith(repo + os.sep):
    sys.exit(1)
rel = os.path.relpath(ap, repo)
if rel == ".":
    sys.exit(1)
def to_re(g):
    g = g.strip().lstrip("./")
    out = ""
    i = 0
    while i < len(g):
        c = g[i]
        if g.startswith("**/", i):
            out += "(?:.*/)?"; i += 3; continue
        if g.startswith("**", i):
            out += ".*"; i += 2; continue
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        else:
            out += re.escape(c)
        i += 1
    return re.compile("^" + out + "$")
for g in globs:
    if not isinstance(g, str) or not g.strip():
        continue
    r = to_re(g)
    if r.match(rel):
        sys.exit(0)
    # A directory glob like docs/ or docs/** also covers everything beneath it.
    if g.rstrip("/") and not any(ch in g for ch in "*?") and (rel == g.rstrip("/") or rel.startswith(g.rstrip("/") + "/")):
        sys.exit(0)
sys.exit(1)
PY
