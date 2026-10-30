-- Keyword numbers bought from a keyword data vendor (DataForSEO, Ahrefs),
-- kept 7 days per keyword, location and language so the same keyword is not
-- bought twice in a week (libs/tools/serp/keywordCache.ts). `scope` is ''
-- for numbers anyone may reuse (DataForSEO's market data) and the org id for
-- numbers bought on a workspace's own licence (Ahrefs). `data` is the
-- keyword's numbers with their source and the date the vendor measured them;
-- `checked_at` is when Vocion read them, which is what the 7 days count from.
CREATE TABLE IF NOT EXISTS "keyword_metric_cache" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"location" text NOT NULL,
	"language" text NOT NULL,
	"keyword" text NOT NULL,
	"data" jsonb NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "keyword_metric_cache_key_idx" ON "keyword_metric_cache" USING btree ("source","scope","location","language","keyword");
