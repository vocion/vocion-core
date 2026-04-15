# Authentication

The API uses tenant-scoped Bearer tokens. One token = one Clerk organization = one tenant context.

## Issuing a token

Dashboard: **Admin → API tokens → Create token**

A token carries:

| Field | Notes |
|---|---|
| `name` | Human-readable label (e.g. "field-notes-mobile-app") |
| `scope` | Default `read:all,run:invoke`. Can narrow to e.g. `read:skills,run:invoke` |
| `expiresAt` | Optional. Default: no expiry. Rotate routinely for production systems |

The token is shown **once** at creation. Store it in your secret manager; the dashboard only keeps a `cmp_live_...` prefix and a hash after that.

## Format

```
cmp_live_<32-char-random>
```

Prefix signals environment: `cmp_live_` for production, `cmp_test_` for non-production.

## Sending requests

```
Authorization: Bearer cmp_live_...
```

## Scopes

| Scope | What it permits |
|---|---|
| `read:all` | `GET` on any building block or run within the tenant |
| `read:skills` | Narrow: only `GET /agents`, `/skills` |
| `write:building blocks` | `POST`/`PATCH` on building block CRUD (equivalent to context-as-code writes) |
| `run:invoke` | `POST /skills/:slug/runs`, `POST /workflows/:slug/runs` |
| `run:approve` | Approve/reject pending runs |

Default new token: `read:all,run:invoke`. Widen or narrow per use case.

## Rate limits

- Default: **60 requests/minute** per token
- Bursts up to 120 tolerated
- `X-RateLimit-Remaining` + `X-RateLimit-Reset` headers on every response
- 429 with `Retry-After` when exceeded

Enterprise tier: raise limits or disable entirely.

## Rotation

```bash
# Create new token, test, then revoke old
curl -H "Authorization: Bearer $NEW_TOKEN" https://.../api/v1/agents
# If good:
curl -X DELETE -H "Authorization: Bearer $NEW_TOKEN" \
  https://.../api/v1/tokens/$OLD_TOKEN_ID
```

Revocation is instant — no grace period.

## Token audit

Every API call records `api_token_id` on the `skill_run` / `workflow_run` / `audit_event` it produced. Full trail: who (token) triggered what, when, and what happened.
