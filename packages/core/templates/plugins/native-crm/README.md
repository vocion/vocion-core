# Native CRM

The GTM home uses the native CRM Lists (companies, contacts, deals, follow-ups)
as its record store. The Lists starter and GTM share deterministic IDs. No
parallel CRM business-object collection is installed.

An admin can start a background HubSpot sync from GTM home. Contacts source
syncs refresh an initialized CRM. Each page saves its cursor and record
changes in one transaction; interrupted imports resume on the next sync.
Imported rows remain read-only during migration; edit them in HubSpot and
sync again. Native rows remain editable in Lists. Counts cover all active
rows and amounts stay grouped by currency. Missing currency stays unknown.

This release defaults outbound delivery to dry run when enabled. Workspace
`defaults.outboundDryRun: true` explicitly holds delivery, sequence enrollment,
CRM mutations and generic external write actions that could dispatch mail.
Gmail draft creation and local planning remain available. This is not a
complete HubSpot replacement: campaign delivery,
JEV qualification execution and historical conversion reporting are pending.
