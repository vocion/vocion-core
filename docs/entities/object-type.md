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

## Rules

- Slugs are unique across object types.
- Only files named `type.yaml` / `type.yml` under `objects/` are loaded — anything else in the folder is treated as a resource, not a manifest.
- An agent's `objectTypes:` entries name these slugs; activating a base agent pulls in the object types it uses.

## Related

[Agent](./agent.md) · [Source](./source.md) · [Object model map](../object-model.md)
