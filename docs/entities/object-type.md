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

`classificationPromptFile` and `classificationPrompt` are both optional; when
either is present the loader resolves it into the type's effective prompt.

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
