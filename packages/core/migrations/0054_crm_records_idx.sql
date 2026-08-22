-- Indexes for the structured CRM read path (`services/CrmRecordsService.ts`).
--
-- The CRM tools answer "how many" with COUNT(*) plus facet GROUP BYs over the
-- FULL match set, not a relevance top-k. Without an index every one of those
-- seq-scans knowledge_document, which grows with every synced mail, doc, and
-- recording, so a lead count would get slower forever.
--
-- A plain GIN on metadata would NOT help: jsonb_ops accelerates containment
-- (@>), not the `metadata->>'key' = value` equality these queries use. B-tree
-- expression indexes on the exact expressions are what apply.
--
-- All partial, so they stay proportional to the CRM mirror rather than to the
-- whole document table. Hand-written; idempotent.
--
-- Primary: org + source + object type. Covers the count, the page, the field
-- probes, and narrows the input to every facet aggregate.
CREATE INDEX IF NOT EXISTS "knowledge_document_crm_object_idx" ON "knowledge_document" ("org_id", "source_id", (("metadata"->>'objectType'))) WHERE "metadata"->>'hubspotId' IS NOT NULL;--> statement-breakpoint
-- Contact lifecycle filter. Indexed on lower(...) because the tool matches
-- case-insensitively ("Lead" and "lead" are the same stage to a caller).
CREATE INDEX IF NOT EXISTS "knowledge_document_crm_lifecycle_idx" ON "knowledge_document" ("org_id", (lower("metadata"->>'lifecycleStage'))) WHERE "metadata"->>'objectType' = 'contacts';--> statement-breakpoint
-- Deal stage filter, same shape.
CREATE INDEX IF NOT EXISTS "knowledge_document_crm_deal_stage_idx" ON "knowledge_document" ("org_id", (lower("metadata"->>'dealStage'))) WHERE "metadata"->>'objectType' = 'deals';
