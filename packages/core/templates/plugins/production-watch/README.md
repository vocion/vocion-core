# Production Watch

Production errors from Sentry become **incidents** a person and an agent can act on.

- **The watch** (`error-watch`, every 10 minutes, toggleable on Automations): reads Sentry for
  the projects it names and opens an `incident` when an issue is new in the last hour with 20
  events, or spiking (20 in 10 minutes, twice the 10 before). The same issue updates the same
  incident; an hour with no events resolves it. Each incident's `cause` — `deploy`, `code` or
  `unknown` — is read by a model from the evidence: the release it first appeared in and when,
  the project's releases, the exception and the app's frames.
- **The on-call engineer** reads each new incident with `sentry_issue`, maps the stack to the
  repository, writes what it found and what it did on the incident, and — when the software
  factory is on and the bug is major (people see it, on a primary flow, recurring) — files a
  factory `request` with the stack as evidence.
- **One notification** per incident (kind `incident`) to the accountable person.

## What it watches

The watch list is the `error-watch` automation's input. Override the automation by slug in your
workspace (`automations/error-watch.yaml`, whole-file replace) with your projects:

```yaml
do:
  job: error-watch
  input:
    recordType: incident
    events: {opened: incident.opened, updated: incident.updated}
    threshold: 20
    windowMinutes: 10
    projects:
      - {project: northwind-api, environment: production, product: northwind}
```

`product` (a product's slug) links each incident to a product record, so it shows under the
product's Related. Connect Sentry first: Connections → Sentry (host, organization, token).

## With the software factory

Loose coupling, by events and existing tools only:

- `incident.opened` with `cause: deploy` is answered by the factory's own `incident-deploy-caused`
  automation, which wakes its Release engineer — the seat that owns reverts.
- A major code bug becomes a factory `request` filed by the on-call engineer.

Without the factory, the incident and the notification are the whole of it.
