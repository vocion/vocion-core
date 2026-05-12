-- Phase L.1 — native pgvector retrieval (Onyx replacement).
-- See packages/core/src/models/Schema.ts for the table-level docs.

-- The pgvector extension is required before any `vector(...)` column is
-- referenced. Most managed Postgres providers ship it pre-installed
-- (Neon, Supabase, AWS RDS Postgres 15+, GCP CloudSQL). For self-hosted
-- installs, `apt install postgresql-XX-pgvector` or the equivalent.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

CREATE TABLE "knowledge_source" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'plugin' NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" text DEFAULT 'true' NOT NULL,
	"last_synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "knowledge_document" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"uri" text,
	"title" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"etag" text,
	"last_modified_at" timestamp,
	"ingested_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- knowledge_chunk's `tsv` is a GENERATED ALWAYS AS STORED column.
-- Drizzle can't emit that syntax directly so we write the CREATE TABLE
-- by hand here. The generation expression uses `to_tsvector('english',
-- content)` — swap the language config when adding non-English content.
CREATE TABLE "knowledge_chunk" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"org_id" text NOT NULL,
	"chunk_idx" integer NOT NULL,
	"content" text NOT NULL,
	"content_tokens" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "knowledge_document" ADD CONSTRAINT "knowledge_document_source_id_knowledge_source_id_fk"
	FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_source"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD CONSTRAINT "knowledge_chunk_document_id_knowledge_document_id_fk"
	FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_document"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "knowledge_source_org_slug_idx" ON "knowledge_source" USING btree ("org_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_document_org_source_external_idx" ON "knowledge_document" USING btree ("org_id","source_id","external_id");--> statement-breakpoint
CREATE INDEX "knowledge_document_content_hash_idx" ON "knowledge_document" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "knowledge_chunk_org_doc_idx_idx" ON "knowledge_chunk" USING btree ("org_id","document_id","chunk_idx");--> statement-breakpoint

-- HNSW index over the cosine-distance operator class. Drizzle's index()
-- builder doesn't know `vector_cosine_ops` so the CREATE INDEX is here.
-- HNSW gives sub-linear k-NN with quality tunable via m + ef_construction.
CREATE INDEX "knowledge_chunk_embedding_hnsw_idx"
	ON "knowledge_chunk" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint

-- GIN index on the generated tsvector for the keyword half of hybrid search.
CREATE INDEX "knowledge_chunk_tsv_gin_idx"
	ON "knowledge_chunk" USING gin ("tsv");
