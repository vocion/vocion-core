#!/usr/bin/env bash
# Start the vocion-core dev server (Next.js, no embedded pglite-server)
# with the umbrella `.env` sourced into the shell *before* `next` starts.
#
# Why: Next.js loads `.env` then `.env.local`, but a symlinked `.env` to the
# umbrella root sometimes fails to propagate inside the nested dev process.
# Shell-exported vars beat any `.env*` file regardless. So we source the
# umbrella `.env` into the shell, then exec the existing dev:next script —
# Next.js sees ANTHROPIC_API_KEY (and friends) already populated.
#
# Use this from the umbrella root:
#   ./vocion-core/scripts/dev-next-with-env.sh
# Or wire it into Terminal 1 per the umbrella README.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
UMBRELLA_ROOT="$(cd "$CORE_REPO/.." && pwd)"

if [ -f "$UMBRELLA_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$UMBRELLA_ROOT/.env"
  set +a
  echo "→ sourced umbrella .env from $UMBRELLA_ROOT/.env"
else
  echo "⚠  no $UMBRELLA_ROOT/.env — LLM-driven features will fail with 'API key not set'" >&2
fi

cd "$CORE_REPO/packages/core"
exec npm run dev:next "$@"
