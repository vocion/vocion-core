# Primitives API

CRUD on the five authored primitives. Mirrors the [concepts](../concepts/) one-for-one.

All paths below are relative to `https://<your-install>/api/v1/`.

## Agents

| Method | Path | Description |
|---|---|---|
| `GET` | `/agents` | List all agents for the tenant |
| `GET` | `/agents/:slug` | Get one agent + its wired skills + workflows |
| `POST` | `/agents` | Create an agent (requires `write:primitives`) |
| `PATCH` | `/agents/:slug` | Update fields or the system prompt |

**Example: list**

```bash
curl -H "Authorization: Bearer $TOKEN" https://.../api/v1/agents
```

```json
{
  "agents": [
    {
      "slug": "ziggy",
      "name": "Ziggy",
      "description": "Sales agent — discovery, deal analysis, proposals",
      "active": true,
      "skillSlugs": ["discovery_summary", "draft_followup_email", "..."],
      "workflowSlugs": ["discovery_followup"],
      "updatedAt": "2026-04-14T20:00:00Z"
    }
  ]
}
```

## Skills

| Method | Path | Description |
|---|---|---|
| `GET` | `/skills` | List skills (query params: `status`, `category`, `limit`) |
| `GET` | `/skills/:slug` | Full manifest (including the prompt template if prompt-form) |
| `POST` | `/skills` | Create a prompt skill — `{ manifest, promptMd }` |
| `PATCH` | `/skills/:slug` | Update manifest fields or the prompt |

## Workflows

| Method | Path | Description |
|---|---|---|
| `GET` | `/workflows` | List workflows |
| `GET` | `/workflows/:slug` | Full workflow manifest (steps + inputSchema) |
| `POST` | `/workflows` | Create a workflow |
| `PATCH` | `/workflows/:slug` | Update trigger, steps, or input schema |

## Objects

Object *types* are authored (YAML). Object *instances* are runtime data (documents, records pushed by connected systems).

| Method | Path | Description |
|---|---|---|
| `GET` | `/objects` | List all instances (query: `type`, `status`, `limit`) |
| `GET` | `/objects/types` | List types (schemas only) |
| `GET` | `/objects/types/:slug` | Type manifest + `sourceRelevance` weights |
| `POST` | `/objects/types` | Create an object type |
| `GET` | `/objects/:id` | Instance detail + linked documents |
| `POST` | `/objects/:slug/instances` | **Ingest a new instance** — main external-integration entry point |
| `PATCH` | `/objects/:id` | Update metadata / status |

**Example: ingest** — use case #26 (construction field notes):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Site 4821 inspection — east retaining wall",
    "metadata": {
      "siteId": "4821",
      "inspector": "mtorres",
      "severity": "medium"
    },
    "content": "Visible cracking along the footing at coordinates ..."
  }' \
  https://.../api/v1/objects/inspection/instances
```

Returns:

```json
{ "id": 42, "slug": "inspection", "title": "Site 4821 ...", "createdAt": "..." }
```

The instance is now indexed (retrieval-visible), linkable from skill runs, and can be used as workflow input.

## Sources

| Method | Path | Description |
|---|---|---|
| `GET` | `/sources` | List configured sources + connection state |
| `GET` | `/sources/:slug` | Source config + retrieval overrides |
| `POST` | `/sources/:slug/reindex` | Trigger a reindex pass (optionally scoped to a filter) |

## Error shape

All endpoints return errors in a consistent shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No skill found for slug \"nonexistent\"",
    "details": { "slug": "nonexistent" }
  }
}
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `CONFLICT`.
