# Rippling

**TL;DR.** Paste a Rippling **API token** on the Connectors page (or tap the
card an agent offers in chat). Agents given the source can read who works
here, their team and manager, who is on leave, and what each pay run cost
by category, live and read-only.
Works today: no OAuth app needed.

## What it reads

Read live, never synced: an HR system's records stay in the HR system.

| Record (`kind`) | Rippling endpoint | Filters that apply |
|---|---|---|
| `worker` | `/employees` (active), `/employees/include_terminated` when a status is asked | text and status (read in pages and filtered here, up to 2,000 people) |
| `department` | `/departments` | text |
| `time_off` | `/leave_requests` | dates, status |
| `pay_run` | `rest.ripplingapis.com`: `/payroll-runs/`, and each run's `/worker-payroll-records/` | dates, status (read whole and filtered here; ten runs per page, since each reads every worker's record) |

A worker's department is shown by name when the token can read departments.

## Pay runs

Pay runs come back as company-wide totals by category; any one person's pay
has no field to land in. Rippling answers one payroll record per worker, and
the provider adds them up before anything leaves it:

| `category` | From each worker's record |
|---|---|
| `gross_wages` | earnings, except reimbursements |
| `employee_taxes` | taxes paid by the employee |
| `employer_taxes` | taxes paid by the employer |
| `employee_deductions` | deductions' employee amounts, and garnishments |
| `employer_contributions` | deductions' employer amounts (benefits, retirement) |
| `reimbursements` | earnings whose category or code is a reimbursement |
| `net_pay` | net pay |

`people_get kind=pay_run` gives each category its `lines`, by Rippling's own
earning, tax and deduction names, each summed across every worker; the list
gives the category amounts only. `reconciliation` says whether gross wages
minus employee taxes minus employee deductions plus reimbursements equals net
pay within a cent, with the `difference`. A run that pays in more than one
currency is left uncategorised rather than added across currencies.

The payroll endpoints are taken from Rippling's published REST reference and
have not yet been read against a live payroll company.

## Tools and actions

- `people_list`, `people_get` — the people family's reads
  ([agent tools](agent-tools.md)).
- No actions. Nothing is ever written to Rippling.

## Connecting it

1. Rippling → Settings → Company settings → **API Access** → create a token.
2. Grant only the work fields: name, title, department, manager, work email,
   start and end dates, employment type, work location, departments, leave
   requests, and payroll runs with their worker payroll records for pay runs.
   Leave SSN, date of birth, home address, compensation and bank details
   unticked.
3. Paste it. **Test connection** reads one employee, department and leave
   request and says which the token may and may not see.

One Rippling company per workspace for now.

## Personal data

Returned, for a worker: name, title, department, manager (Rippling's id),
work email, employment type, work location (city and country, or the site's
name), start and end dates, and status. For time off: whose, when, what
policy, how many hours, and its status. For a pay run: its period, check
date, state and type, and its company-wide totals by category.

Never returned, even if the token was granted them: social security numbers,
dates of birth, home or street addresses, personal emails and phones,
compensation, bank accounts, the reason given for leave, and any one
worker's earnings, taxes or deductions. Records are built from an allowlist;
`services/people/people.test.ts` checks it against an answer carrying all of
these, and checks that no worker's own pay figure comes out of a pay run.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/people/providers/rippling.ts` |
| Pay run categories | `packages/core/src/services/people/payRun.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/rippling.ts` |
| Credential | `rippling` in `packages/core/src/libs/platforms/registry.ts` |
