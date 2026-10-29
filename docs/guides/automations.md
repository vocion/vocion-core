# Automations: one register per workspace

An automation starts work on its own: on a schedule, or when something
happens. Every automation in a workspace is one row in one register, whichever
app brought it, and the register is the same wherever it is drawn.

## Where it is

- **The register**, at `/dashboard/automation` (Workforce → Team → Automations).
  One row per automation: its name, the app that installed it, what it reacts
  to, the seat that owns it, its last run, and a switch that pauses or resumes
  it with Undo.
- **Each app's "How it is doing" panel**, on the app's own pages, lists that
  app's automations beside its agents, skills and measures. These are the
  register's own rows, narrowed to the app, with the same switches. The
  panel's **Automations** heading opens the register filtered to that app.

There is no second register and no app-specific automation screen: an app's
automations are workspace rows like any other.

## Filtering by app

Above the rows, one chip per app that has automations, with how many, and
**All** first. A chip filters the register to that app and writes it into the
URL (`/dashboard/automation?app=seo`), so a filtered register is a link. **This
workspace** holds the automations the workspace authored itself.

Which app an automation belongs to is recorded on the row (`automation.source`:
`plugin:<slug>`, or `workspace`), stamped at every apply, whether the app was
added from the Apps page or the workspace lists it in `workspace.yaml`. A
workspace file that overrides an app's automation by slug keeps the app's
provenance. A row applied before provenance was recorded is placed by the
plugin that ships its slug until the next apply stamps it.

## System automations

Some automations are plumbing: an app's internal hand-off rather than
something a person runs or switches. Such an automation says so in its YAML:

```yaml
slug: invoice-sync-handoff
name: Match synced invoices to their purchase orders
visibility: system
when:
  event: invoices.synced
do:
  job: match-invoices
```

A system automation fires like any other, but it is left out of the register,
the app's panel and the app's **What you get** list. An admin can show them
with **Show system automations** at the foot of the register
(`?system=1`); they are drawn with a **System** label. They stay auditable:
each keeps its page at `/dashboard/automation/<slug>`, every fire is in the
run log, and `GET /api/v1/automations` returns every automation with its
`source` and `visibility`.

## Related

- [Automation](../entities/automation.md) — the YAML, its triggers and guards.
- [Search Engine Optimization](../apps/seo.md) — the weekly "Propose new
  SEO pages for clients behind their monthly pace" automation and the system hand-off.
