# Vocion Infrastructure

## Full Stack

```
localhost:3000  ─── Vocion App (Next.js)
localhost:3200  ─── Langfuse (LLM observability, evals, prompts)
localhost:7233  ─── Temporal gRPC (workflow engine)
localhost:8233  ─── Temporal Web UI (workflow monitoring)
localhost:4317  ─── OTel Collector (gRPC)
localhost:4318  ─── OTel Collector (HTTP)
localhost:5432  ─── Postgres (pgvector + pgcrypto, Vocion DB)
```

Retrieval is first-party: pgvector (HNSW cosine) + Postgres FTS in the Vocion DB itself, served by `services/RetrievalService`. No third-party retrieval engine.

## Quick Start

### 1. Start the Platform (Postgres + Langfuse + Temporal + OTel)

```bash
docker compose -f infra/docker-compose.platform.yml -p vocion-platform up -d
```

### 2. Apply schema

```bash
npm run db:migrate
```

### 3. Start Vocion App

```bash
npm run dev:next   # or `npm run dev` if you want the embedded PGLite
```

### 4. Open Your Tabs

| Service | URL | Credentials |
|---------|-----|-------------|
| Vocion | http://localhost:3000 | NextAuth (demo@example.com / demo123 after seed) |
| Langfuse | http://localhost:3200 | admin@vocion.com / vocion-admin |
| Temporal | http://localhost:8233 | No auth (dev) |

## Port Map

| Service | Port | Container |
|---------|------|-----------|
| Vocion (Next.js) | 3000 | Local process |
| Postgres (pgvector pg16) | 5432 | vocion-postgres |
| Langfuse | 3200 | langfuse-web (remapped from 3000) |
| OTel Collector (gRPC) | 4317 | otel-collector |
| OTel Collector (HTTP) | 4318 | otel-collector |
| Temporal gRPC | 7233 | temporal |
| Temporal UI | 8233 | temporal-ui (remapped from 8080) |

## Stopping Services

```bash
# Stop platform (keep data)
docker compose -f infra/docker-compose.platform.yml -p vocion-platform down

# Stop platform AND delete data
docker compose -f infra/docker-compose.platform.yml -p vocion-platform down -v
```

## Hardware Requirements

- Postgres: 1GB RAM (small demo datasets); scales with chunk count
- Langfuse: 4GB RAM (ClickHouse + PostgreSQL)
- Temporal: 2GB RAM (PostgreSQL)
- Total recommended: 8GB+ RAM for full stack
