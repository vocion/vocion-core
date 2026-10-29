---
slug: audit-site
name: Auditing a client's site
description: >-
  A client's site audited in code: every page from the sitemap, the home
  page's structured data, robots.txt and Google's results for the client's
  name, checked for technical, content, AI-visibility and local problems.
  Filed as the run's audit record and a shareable report, then the
  recommended next steps, each finding fixed by a planned page or a task.
  Read before auditing a client's site.
version: 1
---

# Auditing a client's site

An audit says what is wrong with a client's site, what to fix first, and
what each fix is. The checks are code; your part is the reading and the
order of work.

## 1. Which client

The client's project, as the strategist's prompt says (one ask when the
person has not named one). A new client is onboarded first
(`onboard-client`): a new client's first run is onboard, audit, report,
recommended next steps, in one go.

## 2. Run it

`seo_run_audit` with the project. It reads the whole site again (the site
inventory, filed on the project as a new version), the home page's
Organization schema, robots.txt and Google's first page for the client's
name, and files the run as an `seo_audit` record with a report artifact.
What a person dismissed on the last run stays dismissed; what the last run
had open and this one no longer finds is marked fixed there. Say so when
it happens ("4 findings from 12 October are fixed").

If it says the home page, robots.txt or Google could not be read, say which
check did not run. Never fill in a finding the run did not make.

## 3. Report it

In chat: the headline (open findings, how many high), the recommended next
steps in the order the run gave them, and the report's link, which the
person can share from its page. Do not list every finding: the report and
the audit's page hold them, each with its evidence, pages, date and Fix it.

The order follows the client's SEO profile: Google Business Profile and
local findings first for a local client, AI-visibility findings first when
being named in AI answers is a goal. A project without a profile is audited
anyway; offer the profile (`seo_propose_profile`) in one line.

## 4. Fix what the person picks

`seo_update_findings` with the audit and the findings' keys:

- `plan_page`: a page for each finding in one batch, with its plan's
  sign-off (a missing location page suggests its own; for another finding,
  pass `page` with the keyword and type). Stop there, as with any plan.
- `make_task`: an open item on the client's project for each, with the
  evidence and pages. Fixes a person does on the site (a title, a schema
  block, robots.txt) are tasks.
- `dismiss` with the person's reason, `mark_fixed`, `reopen`: only on the
  person's word. A dismissal is carried to every later run.

Each finding links what fixed it. It stays open until a later audit no
longer finds it, or a person marks it fixed.

## Done when

The run is filed with its report, the person has the headline, the next
steps and the link, and every fix they asked for is a planned page or a
task linked from its finding.
