-- A workspace can now say which vendor and model produce its embeddings.
--
-- Until now the embedder was OpenAI with no switch, so there was nothing to
-- record. Adding Amazon Bedrock as a second embedding provider needs the choice
-- stored per workspace, authored as `defaults.embeddingProvider` /
-- `defaults.embeddingModel` in workspace.yaml and applied by workspace:apply.
--
-- Workspace-scoped and never per-agent, on purpose. Every vector in
-- `knowledge_chunk` came from one model, and a query vector is only comparable
-- to vectors produced by that same model — mixing two embedding spaces returns
-- similarity scores that are numbers but not meaning. Holding the setting on
-- the project row is what makes ingest and query provably the same model.
--
-- Nullable with no default, so every existing workspace keeps resolving its
-- provider from `VOCION_EMBEDDING_PROVIDER` and then from the OpenAI default,
-- exactly as it does today. No row is rewritten and no vector is invalidated.

ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "embedding_config" jsonb;
