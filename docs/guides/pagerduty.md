# PagerDuty

The `pagerduty` source connects the workspace's **on-call pager**. Incidents
are read live and never mirrored — what is firing changes by the minute, the
way Sentry's issues do — so the source ingests nothing; Test connection lists
the services the key sees and reads one incident.

```yaml
kind: pagerduty
config:
  region: us # us | eu (api.eu.pagerduty.com)
  services: [PSV1ABC] # optional: services Test connection confirms
```

## What agents can do

| | |
|---|---|
| `incident_list` | Incidents by status (default triggered and acknowledged), service and time, newest first: number, title, urgency, service, assignees, link. |
| `incident_read` | One incident: description, priority, escalation policy, who it is assigned to and who acknowledged it, how many alerts it grouped, its timeline and its notes. |
| `incident.acknowledge` (action) | Acknowledges a triggered incident, which stops its escalation, recorded as the PagerDuty user the credential names. An incident already acknowledged or resolved is reported as it stands. **No Undo**: PagerDuty does not move an incident back to triggered. |

The tools are present for any agent whose `connectorSources` include a
PagerDuty source.

## Auth

A **REST API key** (Integrations → API Access Keys), sent as
`Authorization: Token token=…`. Read-only is enough to read. To acknowledge,
use a full-access key and give the **email of a PagerDuty user** on the
credential: PagerDuty records every write as a user (`From` header), and the
action refuses with that sentence when none is stored. No OAuth app is
needed.
