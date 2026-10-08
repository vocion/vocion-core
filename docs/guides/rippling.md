# Rippling

**TL;DR.** Paste a Rippling **API token** on the Connectors page (or tap the
card an agent offers in chat). Agents given the source can read who works
here, their team and manager, and who is on leave — live and read-only.
Works today: no OAuth app needed.

## What it reads

Read live, never synced: an HR system's records stay in the HR system.

| Record (`kind`) | Rippling endpoint | Filters that apply |
|---|---|---|
| `worker` | `/employees` (active), `/employees/include_terminated` when a status is asked | text and status (read in pages and filtered here, up to 2,000 people) |
| `department` | `/departments` | text |
| `time_off` | `/leave_requests` | dates, status |

A worker's department is shown by name when the token can read departments.

## Tools and actions

- `people_list`, `people_get` — the people family's reads
  ([agent tools](agent-tools.md)).
- No actions. Nothing is ever written to Rippling.

## Connecting it

1. Rippling → Settings → Company settings → **API Access** → create a token.
2. Grant only the work fields: name, title, department, manager, work email,
   start and end dates, employment type, work location, departments, leave
   requests. Leave SSN, date of birth, home address, compensation and bank
   details unticked.
3. Paste it. **Test connection** reads one employee, department and leave
   request and says which the token may and may not see.

One Rippling company per workspace for now.

## Personal data

Returned, for a worker: name, title, department, manager (Rippling's id),
work email, employment type, work location (city and country, or the site's
name), start and end dates, and status. For time off: whose, when, what
policy, how many hours, and its status.

Never returned, even if the token was granted them: social security numbers,
dates of birth, home or street addresses, personal emails and phones,
compensation, bank accounts, and the reason given for leave. Records are
built from an allowlist; `services/people/people.test.ts` checks it against
an answer carrying all of these.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/people/providers/rippling.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/rippling.ts` |
| Credential | `rippling` in `packages/core/src/libs/platforms/registry.ts` |
