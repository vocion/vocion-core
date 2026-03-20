#!/bin/bash
set -e

# CoreContext - Onyx Infrastructure Setup
# Clones Onyx repo and applies port overrides to avoid conflicts with CoreContext app

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ONYX_DIR="$SCRIPT_DIR/onyx-repo"

echo "=== CoreContext: Onyx Setup ==="

# Step 1: Clone Onyx if not already present
if [ ! -d "$ONYX_DIR" ]; then
  echo "Cloning Onyx repository..."
  git clone --depth 1 https://github.com/onyx-dot-app/onyx.git "$ONYX_DIR"
else
  echo "Onyx repo already exists at $ONYX_DIR"
fi

# Step 2: Copy our port override file
echo "Copying port override compose file..."
cp "$SCRIPT_DIR/docker-compose.override.yml" "$ONYX_DIR/deployment/docker_compose/docker-compose.override.yml"

# Step 3: Create .env if it doesn't exist
ENV_FILE="$ONYX_DIR/deployment/docker_compose/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating .env from template..."
  if [ -f "$ONYX_DIR/deployment/docker_compose/env.template" ]; then
    cp "$ONYX_DIR/deployment/docker_compose/env.template" "$ENV_FILE"
  else
    cat > "$ENV_FILE" << 'ENVEOF'
IMAGE_TAG=latest
AUTH_TYPE=disabled
VALID_EMAIL_DOMAINS=
REQUIRE_EMAIL_VERIFICATION=
SMTP_SERVER=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
ENVEOF
  fi
  echo "NOTE: Edit $ENV_FILE to configure your LLM provider (OpenAI, Anthropic, etc.)"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To start Onyx:"
echo "  cd $ONYX_DIR/deployment/docker_compose"
echo "  docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.override.yml -p onyx-stack up -d"
echo ""
echo "Ports (remapped to avoid CoreContext conflicts):"
echo "  Onyx Web UI:  http://localhost:3100"
echo "  Onyx API:     http://localhost:8080"
echo "  Onyx Postgres: 5433 (internal, not exposed)"
echo ""
echo "CoreContext app remains on:"
echo "  Next.js:      http://localhost:3000"
echo "  PGLite/PG:    localhost:5432"
echo ""
