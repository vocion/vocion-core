# Webhooks

Subscribe to events so you don't have to poll. Useful when the external system that triggered a workflow wants to be notified the moment a result is ready.

## Register a webhook

```
POST /api/v1/webhooks
```

```json
{
  "url": "https://your-app.com/vocion-events",
  "events": ["run.completed", "run.paused_for_review", "run.failed"],
  "filter": {
    "skillSlug": "inspection_review",
    "workflowSlug": null
  },
  "secret": "whsec_..."
}
```

Your `secret` is used to sign every delivery. Store it in your secret manager.

## Event types

| Event | Fires when |
|---|---|
| `run.started` | A skill or workflow run begins |
| `run.step_completed` | One step of a workflow finishes |
| `run.paused_for_review` | A workflow hits an `approve` gate, or a `requiresApproval: true` skill run lands pending |
| `run.approved` / `run.rejected` | A human acts in the review queue |
| `run.completed` | Run finishes successfully |
| `run.failed` | Run errors out |
| `object.created` | A new object instance is ingested |

## Delivery

Vocion `POST`s to your URL with JSON body:

```json
{
  "event": "run.completed",
  "deliveryId": "whd_...",
  "createdAt": "2026-04-14T20:30:00Z",
  "data": {
    "runId": 987,
    "kind": "workflow",
    "slug": "inspection_review",
    "status": "completed",
    "output": {},
    "contextSha": "a8d1795"
  }
}
```

## Signature verification

Every delivery carries an `X-Vocion-Signature` header:

```
X-Vocion-Signature: t=1744654200,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

Verify:

```ts
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret: string, header: string, body: string): boolean {
  const [tPart, sigPart] = header.split(',');
  const timestamp = tPart?.split('=')[1];
  const signature = sigPart?.split('=')[1];
  if (!timestamp || !signature) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}
```

## Retries

- 2xx response → success, delivery marked delivered
- Non-2xx or timeout (30s) → retry with exponential backoff: 1s, 30s, 5m, 1h, 6h, 24h
- After 6 failed attempts → delivery marked `failed`, webhook `disabled` if 10 consecutive failures

## Replay + debug

```
GET /api/v1/webhooks/:id/deliveries
POST /api/v1/webhooks/:id/deliveries/:deliveryId/replay
```

Redeliver any past event with the current secret + current URL.

## Rotating secrets

```
POST /api/v1/webhooks/:id/rotate-secret
```

Returns the new secret. Old secret honored for 10 minutes to allow dual-signing during rollout.
