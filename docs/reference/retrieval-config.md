# Retrieval config

Every knob in `context/<org>/retrieval.yaml`. The full pipeline is **pluggable** — swap embedders, rerankers, chunking strategies without touching code.

> **Status:** Onyx is wired today; the pgvector-native pipeline documented here lands in Phase 5. Current Onyx installations are configured via Onyx's admin UI. Plan your YAML now so the migration is a no-op.

## Full example

```yaml
embedder:
  provider: openai
  model: text-embedding-3-large
  dimensions: 3072
  batch_size: 96

chunking:
  strategy: recursive # recursive | semantic | fixed
  size: 1200
  overlap: 200
  respect_boundaries: [heading, paragraph]

vector:
  store: pgvector
  index: hnsw # hnsw | ivfflat
  m: 16
  ef_construction: 64
  ef_search: 80

keyword:
  store: postgres_fts
  language: english
  boost_fields: {title: 2.0, body: 1.0}

hybrid:
  method: rrf # reciprocal rank fusion
  k_constant: 60
  vector_weight: 1.0
  keyword_weight: 0.6

rerank:
  enabled: true
  provider: voyage
  model: rerank-2
  top_n_input: 40
  top_n_output: 8

query:
  k_nearest: 8
  similarity_threshold: 0.3
  max_context_tokens: 8000

# Per-source / per-domain overrides
overrides:
  sources:
    zoom:
      chunking: {size: 2000, overlap: 300} # longer transcripts
      rerank: {top_n_output: 4}
  domains:
    sales:
      embedder: {model: text-embedding-3-small} # cost optimization
```

## Providers

| Concern | Options |
|---|---|
| Embedder | `openai`, `voyage`, `cohere`, `ollama`, `vllm` |
| Reranker | `voyage`, `cohere`, `bge-local` |
| Vector store | `pgvector` (default), `vespa` (via Onyx) |
| Keyword store | `postgres_fts`, `opensearch` (via Onyx) |

## Auditability

Every `skill_run` persists:

- `retrieval_config_sha` — the hash of the YAML that was active
- `retrieval_hits` — the full set of (document_id, score, rank) tuples returned

Makes "why did the agent retrieve X on March 3rd" a SQL query, not a debugging session.
