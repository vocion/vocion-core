# Sources

> A **Source** is a connected system that feeds raw data into Compiles — Zoom transcripts, Gmail threads, HubSpot records, Google Drive documents, Slack messages, or your own internal systems.

## What it does

A Source has two jobs:

1. **Pull** raw documents in (via OAuth, API key, or push webhooks).
2. **Rank** them during retrieval (via per-source weights so Zoom transcripts don't drown out a HubSpot deal note).

That's it. Everything else — chunking, embedding, hybrid search, reranking — is shared infrastructure and configured in `retrieval.yaml`.

## Where it lives

A Source is authored (Phase 5) in `context/<org>/sources/<slug>/source.yaml`:

```yaml
slug: hubspot
label: HubSpot
description: CRM records — Accounts, Contacts, Deals, Notes
auth:
  type: oauth2
  scopes: [contacts.read, deals.read, notes.read]
filters:
  include:
    - object_types: [deal, contact]
  exclude:
    - fields: [ssn, credit_card]
retrieval:
  chunking: {size: 1500} # override default for HubSpot
  rerank: {top_n_output: 6}
```

## Runtime today

Source runtime is provided by Onyx (deprecating) today, with a pgvector-native pipeline landing in Phase 5. UI lives at `/dashboard/sources`. The authorable YAML shape above is the Phase 5 target; until then, Sources are configured in the Onyx admin UI and referenced by slug from skills and objects.

## Connection to other primitives

- **[Objects](./objects.md)** declare per-source relevance weights via `sourceRelevance`. A Deal object might weight `hubspot: 2.0, gmail: 1.5`.
- **[Skills](./skills.md)** filter retrieval by source via `ctx.retrieve(query, { sources: ['hubspot', 'gmail'] })`.

## Next

- [Writing a plugin](../guides/writing-a-plugin.md) — authoring a custom source adapter as an npm package
- [Retrieval config](../reference/retrieval-config.md) — the hybrid pipeline knobs
