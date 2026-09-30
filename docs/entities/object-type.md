# Object type — `objects/<slug>/type.yaml`

An object type is the *definition* of a business entity — Account, Deal,
Discovery Call. It declares the shape of the record's metadata, which sources
matter most when retrieving for it, and how to classify material into it. The
individual records are runtime data, created through the UI and the classifier;
only the definition is authored.

| | |
|---|---|
| **Path** | `objects/<slug>/type.yaml` — the filename is fixed as `type.yaml` (or `.yml`) |
| **Schema** | `ObjectTypeManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `business_object_type` table |
| **Runtime** | Read back by the built-in `lookup_objects` tool; the classification prompt is stored on the type and applied by the feature paths that classify (e.g. discovery detection) |
| **Surface** | `/api/v1/objects/types`, `/dashboard/objects` |
| **Layering** | Composable — a base default can be patched with `extends: core` |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. |
| `label` | string | required | Display name. |
| `description` | string | — | One-line summary. |
| `icon` | string | — | Lucide icon name. |
| `schema` | JSON Schema | — | The shape of the record's `metadata`. |
| `sourceRelevance` | `{source: number}` | — | Per-source weight when retrieving for this type — higher is more relevant. |
| `classificationPromptFile` | path | — | Markdown prompt used to classify material into this type, relative to `type.yaml`. |
| `classificationPrompt` | string | — | The same prompt, inline. |
| `fewShotExamples` | `{input, output, label?}[]` | `[]` | Worked classification examples. |
| `rollups` | `{field, from: {type, by? \| ids?}, sum?}[]` | — | Figures on this type computed from another type's rows — see *Rollups*. |

`classificationPromptFile` and `classificationPrompt` are both optional; when
either is present the loader resolves it into the type's effective prompt.

## Rollups

A rollup is a figure a record carries that is **computed from another type's
rows** rather than typed: a request's `actualCents` is the sum over its
tasks, its `taskCount` is how many there are. Each entry names the metadata
key written on this type (`field`), the child type (`from.type`), the link —
`by`, the child's key that holds this record's id, or `ids`, this record's
key that lists child ids — and optionally `sum`, the child's key to add up
(omitted, the rollup is a count).

```yaml
# objects/request/type.yaml — the task points at the request
rollups:
  - {field: actualCents, from: {type: engineering_task, by: requestId}, sum: actualCents}
  - {field: taskCount, from: {type: engineering_task, by: requestId}}
```

```yaml
# objects/release/type.yaml — the release lists its tasks
rollups:
  - {field: actualCents, from: {type: engineering_task, ids: taskIds}, sum: actualCents}
```

Rollups are **materialised**, not read on demand: when a child's figures
change, core recomputes every rollup that reaches it over all of each
parent's children and writes the results onto the parent's metadata, with
`rollupsUpdatedAt` beside them (`services/objects/rollups.ts`). Today the
one thing that changes a child this way is a worker run ending for the
record it was queued for (`input.record`; see [Worker run](./worker-run.md)).
The declarations are read from the type files of the plugins the org has on
and the mounted workspace's own `objects/`, the way pages are — nothing about
a rollup reaches the `business_object_type` table.

## Example

```yaml
# objects/discovery_call/type.yaml
slug: discovery_call
label: Discovery Call
description: A first substantive sales conversation with a prospect.
icon: phone
classificationPromptFile: classification-prompt.md
schema:
  type: object
  properties:
    account: {type: string}
    stage: {type: string}
    next_step: {type: string}
sourceRelevance:
  zoom: 2.0
  gmail: 1.0
fewShotExamples:
  - input: 45-minute Zoom with a new mid-market prospect, needs and budget discussed
    output: discovery_call
    label: Clear first substantive conversation.
```

## Settled

A type says when one of its records is finished with `x-settled` on its schema:
the metadata field to read and the values that mean it has settled. Review
reads it to stay true — an undecided item that asks about a record which has
since settled (a request shipped, a task accepted), or that is the review of a
candidate decided on its own record (a plan approved on the plan), is closed by
the review sweep with the reason and a link, never silently. Core itself knows
only that a record `rejected` or `archived` has settled.

```yaml
# objects/request/type.yaml
schema:
  type: object
  x-settled: {field: state, in: [shipped, answered, out_of_scope, deferred]}
```

## Bookkeeping

A type names the metadata paths the machine keeps for itself with `x-bookkeeping`: a
drawing mark, the runs already handled, the time a rollup was last summed. A write that
changes nothing outside them is quiet. It is still written, but it publishes no live notice
(no open page re-reads itself), makes no body version, and raises no `object.updated`, so no
automation wakes for it. `object.updated` names only the fields whose value changed, and an
automation says which fields it reads with `when.filter.fieldsAny` (see
[automation](./automation.md)), so a write of any other field never starts it.

```yaml
# objects/request/type.yaml
schema:
  type: object
  x-bookkeeping: [visuals.mockupDraw, recovery.handledRunIds, rollupsUpdatedAt]
```

## Duplicates

A type asks for a check when one of its records is filed with `x-duplicate-check`: the
integer field that links a duplicate to the record it repeats, the fields a candidate must
share, and what is read beside the title. When a record is filed
(`services/objects/duplicateCheck.ts`), the type's records filed before it that share those
values, are not duplicates themselves, and are open or settled within `settledDays` are
shortlisted (trigram overlap first, then the newest), and one classifier call returns typed
`{duplicateOf, confidence, reason}`. At or above `bar` (default 0.8, the done-for-you bar) the
link is written through `objects.update_meta`, done for you, with Undo on the record's history
and on its status line, which then reads "Duplicate of #N". Below it nothing is written or said.
It never blocks filing: a failed read, an id the model was not shown, or a link a person undid
before all leave the record as filed.

```yaml
# objects/request/type.yaml
schema:
  type: object
  x-duplicate-check: {field: duplicateOf, within: [product], compare: [outcome, story, body], bar: 0.8, settledDays: 14}
```

The software factory's intake runs it before anything is built; a linked request starts nothing.

## Connected records

What a record is connected to is drawn in one **Related** block on its page and in its preview (`components/patterns/Related`), read by one call (`services/objects/related.relatedOf`). A type says what it is connected to with `x-related` on its schema, in terms of what the records already say. Core draws two relations for every record without being told: the chat that started it (`metadata.origin`, written when a record is filed from a conversation), which always comes first, and the artifacts attached to it. A type that declares nothing is connected to whatever its link fields (`x-display: {to: <type>}`) name.

| `from` | reads |
|---|---|
| `links` | records named by this record's `field` (an id, a list of ids, or with `match` a value compared to the other record's metadata `match`, such as a slug) |
| `backlinks` | records whose metadata `field` names this one (its id, or with `match` this record's metadata `match`) |
| `runs` | engineering runs built for this record, or for the records of relation `of` |
| `url` | an https link in `field`, on this record or on the records of relation `of`. It opens outside Vocion and has no preview. |
| `artifacts` | artifacts attached to the record, optionally only one `role` |

```yaml
# objects/request/type.yaml
schema:
  type: object
  x-related:
    - {key: plans, label: Plan, from: backlinks, type: architecture_plan, field: requestId}
    - {key: tasks, label: Engineering tasks, from: backlinks, type: engineering_task, field: requestId}
    - {key: runs, label: Engineering runs, from: runs, of: tasks}
    - {key: pulls, label: Pull requests, from: url, field: prUrl, of: tasks}
```

A relation's `details` say what each related record shows under its link, taken from its own metadata: `{field, label?, format?}`. `format` is one of:
- `text` (the default)
- `sha`: the first 7 characters
- `relative`: "3h ago"
- `count`: "2 checks"
- `present`: `present` or `absent`

With `pick`, an object field is read at this record's metadata key (a repository's `productPaths` under the product's slug).

**Derived fields.** A field the records already say is declared with `x-derived` and read from them at read time, never stored beside them. The record's page and `read_object` show the derived value. A stored value that disagrees is shown as drift under the row it is read from (and as `derivedDrift` in `read_object`), not silently preferred.

```yaml
# objects/product/type.yaml
schema:
  x-derived:
    urls: {relation: environments, value: url, keyBy: surface, where: {stage: production}, keys: {site: marketing, app: web, api: api}}
    repos: {relation: repos, value: slug}
```

## Rules

- Slugs are unique across object types.
- Only files named `type.yaml` / `type.yml` under `objects/` are loaded — anything else in the folder is treated as a resource, not a manifest.
- An agent's `objectTypes:` entries name these slugs; activating a base agent pulls in the object types it uses. They are also what the agent may **write**: `update_object` sets declared fields on a record of a listed type, through the `objects.update_meta` action ([trust](./trust.md#the-agents-own-writes)) — only keys under `schema.properties`, each value checked against its field, never `title`, `status` or the row's bookkeeping. A field the type does not declare is refused with the list of the ones it does, so a new field is a change to `type.yaml` first.

## Related

[Agent](./agent.md) · [Source](./source.md) · [Object model map](../object-model.md)
