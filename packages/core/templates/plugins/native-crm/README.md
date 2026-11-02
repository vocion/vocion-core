# Native CRM foundation

Optional GTM module, installed with `plugins: [native-crm]`. It adds four
workspace-owned object definitions and table/list collection pages using the
platform object service and page renderer. No separate database or record copy.

This is a pilot foundation, not a HubSpot cutover. It does not enroll contacts,
send mail, import external records, or change the authority of existing agents.
HubSpot sources and workflows remain active. No background jobs are installed.

## Shared contracts

The module exports `crm_company`, `crm_contact`, `crm_deal`, and `crm_activity`.
A consumer declares `depends: [native-crm]` and `data.imports` for the types it
uses. Collection pages reference those records; they never own a second copy.
Exports do not grant access: all runtime reads/writes still require workspace
membership and the existing object permissions.

IDs are native object IDs. External mappings belong in the object's existing
`externalSystem` / `externalId` fields, not in its primary ID. Reference metadata
is an initial schema contract; referential integrity and CRM-specific command
validation must land before authoritative use. `outcome` is independent of a
pipeline's stage labels. Amounts use integer minor units with an explicit currency;
this foundation deliberately does not total different currencies.

Disabling the module removes its navigation but retains records and history.
Personal Lists are owned by the platform Lists capability. They must not become
shared CRM records implicitly: promotion/import needs explicit authorization,
validated mappings, preserved provenance, and an idempotent migration command.

## Remaining before replacing HubSpot

Typed CRM commands with reference, stage and ownership validation; a native
provider adapter for existing agents; import/reconciliation tooling; activity
capture; sequence execution and suppression; historical reporting; end-to-end
access and cutover verification. Existing generic record editing is not evidence
that these CRM invariants are enforced.
