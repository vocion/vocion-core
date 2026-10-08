#!/usr/bin/env bash
# verify-full.sh — after a deploy, prove from OUTSIDE that the product works
# for a person, not only that something answers on 443.
#
# A health gate proves the new build is up and that the sign-in page answers.
# None of that says a person can sign in, open a page, or get an answer from an
# agent: a deploy with a broken session, a broken workspace route or a dead
# model key goes green on it. This script is those three moves, as a QA
# account the installation keeps for the purpose:
#
#   1. version    — /version.txt says the build is the one this deploy pins.
#   2. signed-in  — the QA account signs in (Auth.js credentials, the same
#                   form a person uses), its session names it, and a
#                   signed-in page loads (200, not bounced to /sign-in).
#   3. chat       — one chat turn, sent from that page and routed the way the
#                   chat routes it, ends with a `done` event carrying a
#                   non-empty answer.
#
# Every failure exits 1 with its reason on one `::error::verify-full:` line,
# so a CI run is red and says why where the person is looking. Success prints
# one `verify-full: ok` line after a line for what each check read.
#
# Usage, from a parent project's deploy job or an operator's machine:
#
#   HOST=app.example.com PIN=<what this deploy pins> \
#   QA_EMAIL=... QA_PASSWORD=... bash vocion-core/infra/aws/verify-full.sh
#
#   HOST              The installation's hostname, served over https. A full
#                     URL (http://localhost:3000) is used as given.
#   PIN               What the deploy says it is serving. One of:
#                       - a commit: matches version.txt's `deploy-pin` (the
#                         VOCION_DEPLOY_PIN the build was given) or its core
#                         `commit`;
#                       - a release name (v5.1.0): matches version.txt's
#                         `release`, and the build must be that release, not a
#                         commit past it (`version 5.1.0+2` fails). The build
#                         must know its tag: a Docker build has no .git, so
#                         pass --build-arg VOCION_BUILD_DESCRIBE="$(git -C
#                         vocion-core describe --tags --long)" with tags
#                         fetched, or pin by commit.
#   QA_EMAIL          The QA account's sign-in. Keep both in the deploy's
#   QA_PASSWORD       secrets; the account is an ordinary member of the
#                     workspace the page below belongs to.
#   VERIFY_PAGE_PATH  The signed-in page to load and send the chat turn from
#                     (default /dashboard). A workspace page (/w/<slug>/dashboard)
#                     sends the turn to that workspace's agents, as a browser
#                     tab's turn does: the server reads the workspace off the
#                     Referer.
#   VERIFY_TURN_SECONDS  How long the chat turn may take (default 240).
#   VERIFY_MESSAGE    The chat message (default asks for one short sentence).
#
# The password never reaches the log: it goes to curl on stdin, and nothing
# here echoes a request body. The turn is not saved as a conversation (no
# conversation_id is sent), so a deploy leaves nothing in anyone's chat list.
# It does run one real model turn, which the workspace's budget records.
#
# Tested by packages/core/src/scripts/verifyFull.test.ts against a local
# server that answers the way the app does.
set -euo pipefail

fail() {
  echo "::error::verify-full: $1"
  exit 1
}

[ -n "${HOST:-}" ] || fail "HOST is required: the installation's hostname (app.example.com) or URL"
[ -n "${PIN:-}" ] || fail "PIN is required: the commit or release (v5.1.0) this deploy pins"
case "$HOST" in
  *://*) BASE="${HOST%/}" ;;
  *) BASE="https://${HOST%/}" ;;
esac
# The page a person lands on; any signed-in route works.
PAGE_PATH="${VERIFY_PAGE_PATH:-/dashboard}"
case "$PAGE_PATH" in /*) ;; *) PAGE_PATH="/${PAGE_PATH}" ;; esac
TURN_SECONDS="${VERIFY_TURN_SECONDS:-240}"
MESSAGE="${VERIFY_MESSAGE:-Deploy check: reply with one short sentence saying you are here.}"

command -v curl >/dev/null || fail "curl is not installed here"
command -v jq >/dev/null || fail "jq is not installed here"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/cookies"

# 1. VERSION ----------------------------------------------------------------
# version.txt is written by packages/core/scripts/write-version.mjs: one
# `<field> <value>` line per field.
curl -fsS --max-time 15 -o "$WORK/version" "${BASE}/version.txt" 2>/dev/null \
  || fail "version.txt did not answer (GET ${BASE}/version.txt)"
field() { awk -v k="$1" '$1 == k { print $2; exit }' "$WORK/version"; }
case "$PIN" in
  v[0-9]*)
    release=$(field release)
    built=$(field version)
    [ -n "$release" ] && [ "$release" != "unknown" ] || fail "version.txt names no release, so it cannot be ${PIN}. A Docker build knows its release only when given --build-arg VOCION_BUILD_DESCRIBE=\"\$(git -C vocion-core describe --tags --long)\" (tags fetched); or pin by commit"
    [ "$release" = "$PIN" ] || fail "version.txt serves release ${release} but this deploy pins ${PIN}"
    case "$built" in
      *+*) fail "version.txt serves ${built}: ${built##*+} commit(s) past ${PIN}, not ${PIN} itself" ;;
    esac
    echo "verify-full: version ${built} is release ${PIN}"
    ;;
  *)
    deploy_pin=$(field deploy-pin)
    commit=$(field commit)
    if [ -n "$deploy_pin" ] && [ "$deploy_pin" = "$PIN" ]; then
      echo "verify-full: deploy-pin ${PIN:0:12} = pin"
    elif [ -n "$commit" ] && [ "$commit" = "$PIN" ]; then
      echo "verify-full: commit ${PIN:0:12} = pin"
    elif [ -z "$deploy_pin" ] && { [ -z "$commit" ] || [ "$commit" = "unknown" ]; }; then
      fail "version.txt names no deploy-pin and no commit, so it cannot be ${PIN:0:12}"
    else
      fail "version.txt serves deploy-pin ${deploy_pin:-(none)} and commit ${commit:0:12}, but this deploy pins ${PIN:0:12}"
    fi
    ;;
esac

# 2. SIGNED IN --------------------------------------------------------------
if [ -z "${QA_EMAIL:-}" ] || [ -z "${QA_PASSWORD:-}" ]; then
  fail "no QA sign-in to check with: set QA_EMAIL and QA_PASSWORD (from the deploy's secrets)"
fi
export QA_EMAIL QA_PASSWORD
csrf=$(curl -fsS --max-time 15 -c "$JAR" -b "$JAR" "${BASE}/api/auth/csrf" | jq -r '.csrfToken // empty') \
  || fail "the sign-in service did not answer (GET /api/auth/csrf)"
[ -n "$csrf" ] || fail "the sign-in service returned no CSRF token"
# The form is built from the environment and sent over stdin, so the
# password is on no command line and in no log line.
code=$(CSRF="$csrf" jq -rn '"csrfToken=\(env.CSRF|@uri)&email=\(env.QA_EMAIL|@uri)&password=\(env.QA_PASSWORD|@uri)&json=true"' \
  | curl -sS --max-time 20 -c "$JAR" -b "$JAR" -o "$WORK/signin" -w '%{http_code}' \
    -H 'content-type: application/x-www-form-urlencoded' -H "origin: ${BASE}" \
    --data-binary @- "${BASE}/api/auth/callback/credentials") || fail "sign-in did not answer"
case "$code" in 200|302|303) ;; *) fail "sign-in answered HTTP ${code}" ;; esac
session=$(curl -fsS --max-time 15 -b "$JAR" "${BASE}/api/auth/session" | jq -r '.user.email // empty') \
  || fail "the session read did not answer (GET /api/auth/session)"
[ -n "$session" ] || fail "the QA account did not sign in: the session is empty (wrong password, or the account is gone)"
[ "$(printf '%s' "$session" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$QA_EMAIL" | tr '[:upper:]' '[:lower:]')" ] \
  || fail "the session names a different account than the QA sign-in"
read -r page_code page_url < <(curl -sS -L --max-time 30 -b "$JAR" -o "$WORK/page" -w '%{http_code} %{url_effective}\n' "${BASE}${PAGE_PATH}") \
  || fail "the signed-in page ${PAGE_PATH} did not answer"
case "$page_url" in *"/sign-in"*) fail "the signed-in page ${PAGE_PATH} bounced to sign-in (${page_url#"$BASE"})" ;; esac
[ "$page_code" = "200" ] || fail "the signed-in page ${PAGE_PATH} answered HTTP ${page_code} at ${page_url#"$BASE"}"
echo "verify-full: signed in as the QA account; ${PAGE_PATH} loaded (200 at ${page_url#"$BASE"})"

# 3. ONE CHAT TURN ----------------------------------------------------------
body=$(jq -cn --arg m "$MESSAGE" '{message: $m, route: true, time_zone: "UTC"}')
turn_code=$(curl -sS -N --max-time "$TURN_SECONDS" -b "$JAR" -o "$WORK/turn" -w '%{http_code}' \
  -H 'content-type: application/json' -H "origin: ${BASE}" -H "referer: ${page_url}" \
  --data-binary "$body" "${BASE}/rpc/agent/stream" || true)
[ "$turn_code" = "200" ] || fail "the chat turn answered HTTP ${turn_code:-nothing}: $(head -c 300 "$WORK/turn" 2>/dev/null | tr -d '\n')"
# The stream is typed events, one `data: <json>` block each. Read the types,
# never the words: `done` carries the answer, `error` carries why not.
events="$WORK/events"
sed -n 's/^data: //p' "$WORK/turn" | jq -c 'select(type == "object")' > "$events" 2>/dev/null || true
error=$(jq -r 'select(.type == "error") | (.message // "an error event with no message")' "$events" | head -1)
[ -z "$error" ] || fail "the chat turn failed: ${error:0:300}"
done_events=$(jq -s '[.[] | select(.type == "done")] | length' "$events")
[ "${done_events:-0}" -gt 0 ] || fail "the chat turn never finished: no done event within ${TURN_SECONDS}s ($(wc -l < "$events" | tr -d ' ') events read)"
# A turn can close with a second, empty `done` (the stream's own close), so
# the answer is the first `done` that carries one.
answer=$(jq -r 'select(.type == "done") | .response // empty | select(length > 0)' "$events" | head -1)
[ -n "$answer" ] || fail "the chat turn finished with an empty answer"
agent=$(jq -r 'select(.type == "routed") | .agent.slug // empty' "$events" | head -1)
echo "verify-full: chat turn answered${agent:+ by ${agent}} (${#answer} chars)"

echo "verify-full: ok — version, signed-in page and one chat turn on ${BASE#*://}"
