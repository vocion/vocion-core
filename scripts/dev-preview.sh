#!/usr/bin/env bash
# Keep https://dev.agents.metacto.com serving THIS checkout, unattended.
#
# Why cloudflared and not `ssh -R`, which is what this used to be: an ssh
# reverse tunnel carries every HTTP request over ONE TCP connection, so
# requests queue behind each other. Measured on the same 307: 4ms served
# locally, 8.6s through ssh, 0.14s through cloudflared. A page needing 29
# asset requests turned that into minutes of blank screen, which read as "the
# app is broken" when the app was fine and the pipe was not.
#
# Four things have to hold for the preview to exist:
#   1. the Mac awake          — a sleeping laptop takes everything with it
#   2. `next dev` on :3000    — the thing being previewed
#   3. cloudflared            — laptop -> Cloudflare edge (QUIC, multiplexed)
#   4. Caddy on the box       — dev.agents.metacto.com -> that tunnel hostname
#
# A quick tunnel gets a RANDOM hostname every start, so (4) has to be rewritten
# whenever (3) restarts. That is the whole reason this script owns the
# Caddyfile edit: otherwise a 3am cloudflared blip silently points the vanity
# URL at a tunnel that no longer exists.
#
# Usage:  nohup scripts/dev-preview.sh &
set -uo pipefail

BOX="${VOCION_PREVIEW_BOX:-ec2-user@agents.metacto.com}"
KEY="${VOCION_PREVIEW_KEY:-$HOME/.ssh/metacto-owned.pem}"
PORT="${VOCION_PREVIEW_PORT:-3000}"
VANITY="${VOCION_PREVIEW_VANITY:-dev.agents.metacto.com}"
WORKSPACE="${WORKSPACE_PATH:-$HOME/projects/metacto-vocion-agents/workspace/squatch-factory}"
CORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/packages/core"
LOGDIR="${VOCION_PREVIEW_LOGS:-$HOME/.vocion-preview}"
CFBIN="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
mkdir -p "$LOGDIR"
CURRENT=""

log() { echo "$(date '+%F %T') $*" | tee -a "$LOGDIR/supervisor.log"; }
log "supervisor pid $$ — serving $CORE on :$PORT as https://$VANITY"

caffeinate -dimsu -w $$ &

dev_up() { curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/sign-in"; }
start_dev() {
  log "starting next dev"
  ( cd "$CORE" && WORKSPACE_PATH="$WORKSPACE" npm run dev:next >> "$LOGDIR/dev.log" 2>&1 & )
}

tunnel_host() { grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOGDIR/tunnel.log" 2>/dev/null | tail -1 | sed 's|https://||'; }
tunnel_up()   { pgrep -f "cloudflared tunnel --url http://localhost:$PORT" >/dev/null 2>&1; }
start_tunnel() {
  log "starting cloudflared"
  : > "$LOGDIR/tunnel.log"
  "$CFBIN" tunnel --url "http://localhost:$PORT" >> "$LOGDIR/tunnel.log" 2>&1 &
}

# Repoint the vanity host at whatever hostname cloudflared currently holds.
# Validated before reload: a bad Caddyfile on this box would take production
# down with it, since agents.metacto.com is served from the same file.
point_caddy() {
  local host="$1"
  log "pointing $VANITY -> $host"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$BOX" \
    "sudo python3 -c \"
import re,sys
cf='$host'
p='/opt/vocion/infra/aws/Caddyfile'
s=open(p).read()
s=re.sub(r'(dev\.agents\.metacto\.com \{.*?\n\})', lambda m: re.sub(r'[a-z0-9-]+\.trycloudflare\.com', cf, m.group(1)), s, count=1, flags=re.S)
open(p,'w').write(s)
\" && sudo docker exec vocion-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && sudo docker exec vocion-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile" \
    >> "$LOGDIR/caddy.log" 2>&1 && log "caddy reloaded" || log "CADDY REPOINT FAILED — vanity URL stale"
}

while true; do
  dev_up || start_dev
  if ! tunnel_up; then
    start_tunnel
    sleep 12
    CURRENT=""
  fi
  host="$(tunnel_host)"
  if [ -n "$host" ] && [ "$host" != "$CURRENT" ]; then
    point_caddy "$host" && CURRENT="$host"
  fi
  sleep 15
done
