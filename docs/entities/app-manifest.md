# App manifest — `app.yaml`

What a person picks in the dashboard's left rail. An app is a named set of
plugins and the nav sections their rows sit in, plus the **home** it opens
on. It adds no capability of its own: it is installed in a workspace exactly
when one of its plugins (or surfaces) is on there, so
`project.enabled_plugins` stays the one record of what a workspace has.

| | |
|---|---|
| **Path** | `packages/core/templates/apps/<id>/app.yaml` (shipped by core; not authored in a workspace) |
| **Schema** | `AppManifestSchema` (with `AppHomeSchema`, `AppLaunchTileSchema`, `AppHomeMeasureSchema`) in `packages/core/src/libs/workspace/schemas.ts` |
| **Loaded by** | `libs/workspace/apps.ts`; resolved per workspace by `features/navigation/apps.ts` |
| **Home page** | `/dashboard/apps/<id>/home`: `app/[locale]/(auth)/dashboard/apps/[app]/home/page.tsx`, read by `services/apps/appHome.ts`, figures in `libs/workspace/appHome.ts` |

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `id` | slug | yes | The app's id; must match its directory. |
| `name` | string | yes | What the app is called. |
| `shortName` | string | no | What the sidebar header and the home's ask bar say when the name is long ("SEO"). |
| `icon` | lucide name | yes | Resolved by `features/dashboard/iconByName.ts`. |
| `tint` | `violet` … `rose` | no | The colour block the app wears in the rail, its header, its home's tiles and the marketplace. Derived from the id when omitted. |
| `order` | number | no (100) | Rail position, lowest first. |
| `core` | boolean | no | The app every workspace has (Workforce). Exactly one sets it; it lists no plugins. |
| `hidden` | boolean | no | A slot not offered yet. |
| `description` | string | yes | One line: what the app is for. The empty home shows it under the greeting. |
| `plugins` | slug[] | no | Member plugins. Any one on puts the app in the workspace. |
| `surfaces` | string[] | no | Core surfaces that belong to the app. |
| `entry` | path | yes | Where the app lands when it has no `home`. |
| `nav` | string[] | no | The nav section labels the app owns. |
| `home` | object | no | The page the app opens on. See below. |

## `home` — where the app opens

Founder, 2026-10-30: a person who landed on an empty SEO chat did not know what
to do first. An app that declares a `home` opens there, like a launchpad: a
greeting, an ask bar, big tiles for what you can do, what waits on you and how
the work stands. Chat stays one row below it in the nav.

The page, top to bottom:

1. **Greeting and ask bar.** "Good morning, Avery", then "Ask the SEO team…".
   Sending opens Chat with the words as the person's first message
   (`/dashboard/chat?ask=`). The home is the app's own page, so the sidebar has
   already named the app in the `vocion_nav_app` cookie and the turn routes to
   the app's lead (`services/chat/appScope.ts`, #1529).
2. **Start something.** The `launch` tiles, the one emphasized element: front
   doors (`CatalogCard`) on the app's tint, two to a row on a phone.
3. **Needs you.** The app's agents' open decisions, one decision card at a
   time, recommended option first, answered in place (`decisions.answer`).
   A decision asked inside a chat is a row that opens that chat, where the
   agent hears the answer. No section when nothing waits, and no "N waiting"
   nudge.
4. **Where things stand.** `measures` for the whole workspace, then one block
   per project using the app with `projects.measures`. Every figure links to
   its evidence and carries the date it was true.
5. **Running now and recently made.** Mission runs the app's agents lead and
   workflow runs they own (by their run labels), and artifacts they wrote in
   the last two weeks.

**An app with nothing yet** (no project, record, run, artifact or decision of
its own) shows only the ask bar, its first tile (`firstTitle`, e.g. "Onboard
your first client") and its `description`.

**Navigation.** Home is the app's first nav row, above Chat and Review, and its
landing the first time. After that the rail opens each app where the person
left it in that workspace (`rememberAppPlace`, `nav/workspaceMemory.ts`); a
workspace switch still lands on the target's own last place, else its home
app's home (`workspaceLanding`).

**Fast.** Sections 3–5 stream under their own `<Suspense>`, every read is
bounded (2,000 records a type, 8 project blocks, 6 runs and 6 artifacts), none
calls a model, and a failed read leaves its part out.

### `launch` — one to six tiles

| Field | What it does |
|---|---|
| `title` | The tile's name: an action and its object ("Audit a site"). |
| `description` | One plain line: what it does for the person. |
| `icon` | lucide name. |
| `ask` | The person's words to the app's lead, sent as a new chat's first message. The lead raises any card (onboarding, a plan) from there. |
| `prompt` | The words left in the composer for the person to finish ("Onboard a new client from their website: "). |
| `href` | A page of the app (`/dashboard/p/seo-pages?status=approved`). |
| `workflow` | A workflow's run form (`/dashboard/workflows/<slug>/run`). |
| `accepts` | File extensions a person may drop on a `prompt` tile (`[.csv]`): the file is uploaded as the composer would and Chat opens with it attached under the words. |
| `first` | The tile an empty app shows alone (else the first). At most one. |
| `firstTitle` | Its title on the empty home. |

Exactly one of `ask`, `prompt`, `href` and `workflow`.

### Measures

Each reads state core already keeps; nothing is stored for the home.

| `source` | Reads | Figure | Dated by |
|---|---|---|---|
| `records` | The app's records of `objectType`, narrowed by `where` (the page filter grammar, `since: month` included); on a project block only those whose `projectField` (default `meta.projectId`) names it | `stat: count` (default), `sum` of `field`, or `latest`: `field` of the newest by `date`, with `breakdown` figures beside it | the newest `date` among the counted records |
| `project` | A field of the project's own record (project blocks only) | `field` | `date` |
| `state` | A saved `view` (`state_view`, core views in `libs/state/coreViews.json`) or a `query` over synced systems (workspace only) | its count, or `sum` of a number facet over every match | the oldest sync of the sources it read |
| `approvals` | Proposals waiting in Review for `actions` (ids or `prefix.*`); on a project block, those whose input names it under `projectKey` | the count | the oldest waiting |
| `mission` | The newest run of `mission` (workspace only) | its state ("Running", "Done") | when it last moved |

`of` (a second filter) or `target` (a field of the project, e.g.
`meta.seoCadence.pagesPerMonth`) adds "of N". `format: money | cents` shows
currency (`currency`, USD by default). `href` is where the evidence is, with
`{projectId}` and, for `latest`, the record's `{id}` or `{meta.…}` filled in; a
link that cannot be filled is not drawn. A `state` measure with no `href` opens
a chat asking for the list.

**Reduction.** A figure that cannot be read (a system not connected or never
synced, no record for `latest`) is left out, never drawn as a zero with an
apology. A count of zero is a reading and stays.

### Example

```yaml
home:
  launch:
    - title: Onboard a client
      description: Read a client's website and set up their project, voice and SEO profile on one card.
      icon: user-plus
      prompt: 'Onboard a new client from their website: '
      first: true
      firstTitle: Onboard your first client
    - title: Publish
      description: Pages you signed off, ready to go to each client's site.
      icon: send
      href: /dashboard/p/seo-pages?status=approved
  projects:
    include: {field: meta.seoProfile, op: exists}
    measures:
      - key: live
        label: Pages live this month
        source: records
        objectType: seo_page
        where: [{field: meta.status, op: eq, value: published}, {field: meta.publishedAt, op: since, value: month}]
        date: meta.publishedAt
        target: meta.seoCadence.pagesPerMonth
        href: /dashboard/p/seo-pages?project={projectId}&status=published
```

The shipped homes: [SEO](../apps/seo.md#home), [Finance](../apps/finance.md),
[GTM](../apps/gtm.md) and [Paid Marketing](../apps/marketing.md#home).
