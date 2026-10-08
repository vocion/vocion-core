# Workday

**TL;DR.** Give Vocion an **integration system user** and name the custom
report(s) to read. Agents given the source can read who works here, their
organization and manager, and who is out — live and read-only, through
Workday's Report-as-a-Service. Works today: no OAuth app needed.

## What it reads

Read live, never synced. A Workday tenant's data model is its own, so the
source reads the custom reports you build for it:

| Record (`kind`) | Report (source setting) | Columns read, first match wins |
|---|---|---|
| `worker` | `workersReport` (required) | id `Employee_ID`/`Worker_ID`; name `Worker`/`Legal_Name`; title `Business_Title`/`Job_Title`; team `Supervisory_Organization`/`Department`/`Cost_Center`; `Manager`; work email `Email_-_Work`/`Work_Email`; `Worker_Type`; `Location`; `Hire_Date`; `Termination_Date`; status `Worker_Status`/`Status` or `Active` |
| `time_off` | `timeOffReport` (optional) | `Worker`, `Time_Off_Type`, `Start_Date`/`Date`, `End_Date`, `Status`, `Units`/`Hours` |

Each report is fetched whole as JSON and filtered (text, status, dates) and
paged here. A report setting is `<owner>/<report name>` from its web service
URL, or the whole URL — which must be on the credential's own host.

## Tools and actions

- `people_list`, `people_get` — the people family's reads
  ([agent tools](agent-tools.md)).
- No actions. Nothing is ever written to Workday.

## Connecting it

1. Create an integration system user and a security group that may **Get**
   the custom reports, and nothing else.
2. Build the workers report (and, if wanted, a time-off report) with **only
   work columns**, and tick **Enable as Web Service**.
3. On the Connectors page, add **Workday**: the services host
   (`https://wd2-impl-services1.workday.com`), the tenant, the user and its
   password, then the report names. **Test connection** reads each report once.

Some tenants expect the user as `name@tenant`; enter it the way your tenant
signs integration users in.

## Personal data

Returned: only the columns listed above. Every other column a report
carries — a national id, a birth date, a home address, a personal email or
phone, pay, bank details, comments — is dropped before an agent sees the
record; `services/people/people.test.ts` checks it. The safest report still
carries only work columns, so build it that way.

## Where it lives

| | |
|---|---|
| Provider | `packages/core/src/services/people/providers/workday.ts` |
| Connector (Test connection) | `packages/core/src/libs/sources/workday.ts` |
| Credential | `workday` in `packages/core/src/libs/platforms/registry.ts` |
