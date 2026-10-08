# Gusto

**TL;DR.** Log in with Gusto on the Connectors page (or tap the card an
agent offers in chat). Agents given the source can read who works here, in
which department, who is out, and what each pay run cost in total — live and
read-only. Needs a Gusto OAuth app on the server or the workspace.

## What it reads

Read live, never synced: an HR system is where personal data lives, so
nothing is copied into the index or sent to an embedding model.

| Record (`kind`) | Gusto object | Filters that apply |
|---|---|---|
| `worker` | Employee | text (Gusto's `search_term`), status `active` / `terminated` |
| `department` | Department | text |
| `pay_run` | Payroll, with `include=totals` | dates (pay period), `processed` (default) or `unprocessed` |
| `time_off` | Time off request | dates, status, text |

A filter Gusto cannot apply is listed as `ignored`.

## Tools and actions

- `people_list`, `people_get` — the people family's reads
  ([agent tools](agent-tools.md)); present for an agent whose sources
  include the Gusto source.
- No actions. Nothing is ever written to Gusto.

## Connecting it

Login only: Gusto issues no API key, and its refresh token is single use
(every refresh returns the next one), so only a saved login can keep it.

1. **A Gusto app**, once per deployment: create it in the Gusto developer
   portal with read access to companies, employees, departments, payrolls and
   time off. Redirect URI: `<NEXT_PUBLIC_APP_URL>/api/connect/gusto/callback`.
2. **Save it** in the server's env as `GUSTO_CLIENT_ID` and
   `GUSTO_CLIENT_SECRET`, or as the workspace's own **Gusto login app** on the
   Developers page (no redeploy; see [login-apps.md](login-apps.md)). The
   workspace's app wins over the server's.
3. On `/dashboard/connectors`, add **Gusto** and press **Log in with Gusto**.
   The login names the company it is for; that is all it takes.

Without an app, the connector card says an admin needs to configure Gusto
OAuth. One Gusto company per workspace for now.

## Personal data

Returned, for a worker: name, job title, department, manager (Gusto's id),
work email, start and termination dates, and status. For time off: whose,
which days, what kind, how many hours, and its status. For a pay run: the
period, the check date, and the company's gross, net and employer-tax totals.

Never returned, whatever Gusto sends: social security numbers, dates of
birth, home addresses, personal emails and phones, bank accounts, pay rates
or any one person's pay, and notes on a time-off request. Each record is
built from an allowlist of fields, and `services/people/people.test.ts`
feeds the provider an answer carrying all of these and checks none comes out.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/people/providers/gusto.ts` |
| Login | `packages/core/src/libs/connect/providers/gusto.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/gusto.ts` |
| Credential | `gusto` and `gusto-login-app` in `packages/core/src/libs/platforms/registry.ts` |
