-- An image artifact keeps its bytes in Vocion, not behind someone else's link.
--
-- QA screenshots arrived as S3 presigned GETs, which SigV4 caps at seven days;
-- a week after each run every release's and feature's proof stopped loading
-- (2026-09-28). An image that arrives with an external URL is now copied into
-- the artifact store and `url` points at the copy. `source_url` keeps the link
-- it arrived with; `ingest` records what happened when the copy was tried, so a
-- failure says why and the sweep can retry it while the link is still valid.
--
-- Both nullable, no default: ADD COLUMN is a catalog-only change, no rewrite,
-- and a row nobody ingested reads exactly as it did.
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "source_url" text;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "ingest" jsonb;
