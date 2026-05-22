# Vocion Infrastructure

## Full Stack

```
localhost:3000  ─── Vocion App (Next.js)
localhost:3100  ─── Onyx Web UI (context engine admin)
localhost:3200  ─── Langfuse (LLM observability, evals, prompts)
localhost:7233  ─── Temporal gRPC (workflow engine)
localhost:8080  ─── Onyx API
localhost:8233  ─── Temporal Web UI (workflow monitoring)
localhost:4317  ─── OTel Collector (gRPC)
localhost:4318  ─── OTel Collector (HTTP)
```

## Quick Start

### 1. Start Onyx (context engine)

```bash
./infra/onyx/setup.sh   # First time only - clones repo + applies port overrides

cd infra/onyx/onyx-repo/deployment/docker_compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.override.yml \
  -p onyx-stack up -d
```

### 2. Start Platform Services (Langfuse + Temporal + OTel)

```bash
docker compose -f infra/docker-compose.platform.yml -p vocion-platform up -d
```

### 3. Start Vocion App

```bash
npm run dev
```

### 4. Open Your Tabs

| Service | URL | Credentials |
|---------|-----|-------------|
| Vocion | http://localhost:3000 | Clerk auth |
| Onyx Admin | http://localhost:3100 | Set up on first visit |
| Langfuse | http://localhost:3200 | admin@vocion.com / vocion-admin |
| Temporal | http://localhost:8233 | No auth (dev) |

## Configure Onyx

1. Open http://localhost:3100
2. Set up LLM provider (OpenAI or Anthropic API key)
3. Create API key: Admin > API Keys
4. Add to `.env.local`:
   ```
   ONYX_API_URL=http://localhost:8080/api
   ONYX_API_KEY=your_key
   ```

## Port Map

| Service | Port | Container |
|---------|------|-----------|
| Vocion (Next.js) | 3000 | Local process |
| Onyx Web UI | 3100 | nginx (remapped from 3000) |
| Langfuse | 3200 | langfuse-web (remapped from 3000) |
| OTel Collector (gRPC) | 4317 | otel-collector |
| OTel Collector (HTTP) | 4318 | otel-collector |
| Temporal gRPC | 7233 | temporal |
| Onyx API | 8080 | api_server |
| Temporal UI | 8233 | temporal-ui (remapped from 8080) |
| Vocion PGLite | 5432 | Local process |
| Onyx PostgreSQL | 5433 | relational_db (remapped from 5432) |
| Onyx Redis | 6380 | cache (remapped from 6379) |

## Stopping Services

```bash
# Stop Onyx
cd infra/onyx/onyx-repo/deployment/docker_compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.override.yml \
  -p onyx-stack down

# Stop Platform (Langfuse + Temporal + OTel)
docker compose -f infra/docker-compose.platform.yml -p vocion-platform down

# Stop Platform AND delete data
docker compose -f infra/docker-compose.platform.yml -p vocion-platform down -v
```

## Hardware Requirements

- Onyx: 8GB+ RAM recommended (includes model inference)
- Langfuse: 4GB RAM (ClickHouse + PostgreSQL)
- Temporal: 2GB RAM (PostgreSQL)
- Total recommended: 16GB+ RAM for full stack
