# Objects

> An **Object** is a business entity your tenant cares about — Account, Deal, Discovery Call, Ticket. It's the unit of grounded truth an Agent reasons over.

## What it does

An Object type declares a business entity once; every document that mentions it can be linked back to a single row, and every Skill that needs context about it gets the same canonical record.

Instances (e.g., "Acme Corp") live as rows in the `business_object` table, one per tenant, linked to documents in your Sources. An Agent asked "what's happening with Acme?" retrieves *the Acme Corp row*, not ten emails that all partially describe it.

## Folder shape

```
context/<org>/objects/<slug>/
├── type.yaml                   # structured definition (required)
├── classification-prompt.md    # tells the classifier how to recognize this type (optional)
├── evals.yaml                  # classification fixtures (recommended)
└── README.md                   # optional — rationale, edge cases
```

### `type.yaml`

```yaml
slug: deal
label: Deal
description: Sales opportunity tracked across CRM, email, and documents
icon: handshake
sourceRelevance:
  hubspot: 2.0
  gmail: 1.5
  zoom: 1.3
  google_drive: 1.2
```

### `classification-prompt.md`

Optional. Tells the `classify_business_object` skill how to recognize *this kind* of object in a document. Free-form markdown — the LLM sees it verbatim.

### `evals.yaml`

Classification fixtures — document in, yes/no out, which instance it should link to. See [Evals](../guides/evals.md) for the full shape.

## Runtime

- `classify_business_object` skill reads new documents, uses the classification prompt to decide "is this a Deal?", and writes a row if yes.
- `generate_summary` skill keeps the object's `summary` field fresh based on linked documents.
- Any Skill can call `ctx.retrieve('Acme Corp', { sources: ['hubspot'] })` + resolve matches back to the object row.

## Connection to other building blocks

- **[Sources](./sources.md)** — `sourceRelevance` weights which connectors are most authoritative for this object type
- **[Skills](./skills.md)** — typically take an `objectId` as input and update the object's fields as output
- **[Workflows](./workflows.md)** — orchestrate classify → summarize → enrich for every new document

## Next

- [Authoring context](../guides/authoring-context.md) — the editor + apply cycle
- [Skills](./skills.md) — the LLM-powered capabilities that read and mutate Objects
- [Evals](../guides/evals.md) — classification fixtures
