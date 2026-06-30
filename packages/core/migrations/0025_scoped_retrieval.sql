-- Scoped retrieval + document ACL: sub-org (client/team) segmentation on the
-- knowledge store. NULL = org-wide/shared. A non-null client_id makes a doc
-- visible only to retrievals scoped to that client (cross-client isolation).
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "team_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN IF NOT EXISTS "client_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunk" ADD COLUMN IF NOT EXISTS "team_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_document_org_client_idx" ON "knowledge_document" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_chunk_org_client_idx" ON "knowledge_chunk" USING btree ("org_id","client_id");
