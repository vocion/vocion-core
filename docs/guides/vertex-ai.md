# Google Vertex AI

Gemini on Vertex AI as a model provider for chat and for embeddings, on the workspace's own
Google Cloud project.

- **Credential.** API credentials → Google Vertex AI: paste a **service-account JSON key** whose
  account has the *Vertex AI User* role (a bare access token also works, for its hour). The
  project comes from the key unless you name one; the region defaults to `us-central1`
  (`global` works too). Server fallback: `VERTEX_CREDENTIALS`, `VERTEX_PROJECT_ID`,
  `VERTEX_LOCATION`.
- **Chat.** `harness: { modelProvider: vertex, model: google/gemini-2.5-flash }`. Defaults:
  `google/gemini-2.5-pro` (main), `google/gemini-2.5-flash` (classifier, skill turns, extractor).
  Calls go through Vertex's OpenAI-compatible endpoint
  (`…/projects/<p>/locations/<l>/endpoints/openapi`), so tool calls work as on OpenAI. A fresh
  access token is minted from the key and reused until near expiry.
- **Embeddings.** `defaults: { embeddingProvider: vertex }` in `workspace.yaml` embeds with
  `gemini-embedding-001` asked for **1536 dimensions** (`outputDimensionality`), the column's
  width; every vector's width is checked before it is stored, as on every backend.
- **Price.** Gemini 2.5 Pro and Flash are priced in `libs/pricing.ts` (ai.google.dev pricing,
  2026-10-08); Vertex reports `google/<model>` and the publisher is stripped to price it.
- **Sync callers.** A path with no workspace in hand (`buildChatModel` without an org) cannot
  exchange a service-account key, so there it needs `VERTEX_CREDENTIALS` as an access token.
