-- 0112 — the personalization lead becomes three artifacts, and a decision
-- pins the versions it approved.
--
-- `docs/specs/personalization-v2.md`. The CEO's review asked for the research
-- brief, the outreach recommendation and the draft sequence to stop being one
-- page and become three things that can be referenced, edited, versioned and
-- cited. That is the artifact contract exactly (0095, 0101), so this migration
-- extends artifacts rather than building a `brief` table beside them
-- (MANIFESTO §19; `docs/design/reduction.md` Part 2).
--
-- Four additive changes:
--
--   artifact.record_type / record_id / record_role
--       Artifacts were conversation-scoped. A brief belongs to a RECORD. The
--       pair is a `RecordRef` (`services/chat/pageContext.ts`) stored flat, so
--       every surface that already renders a ref can render an artifact's
--       home; `record_role` says what the artifact IS to that record — `brief`,
--       `recommendation`, `sequence` — which is what makes "the brief for this
--       lead" a lookup rather than a title match. Nullable: a conversation
--       artifact has no record and keeps working untouched.
--
--       Role uniqueness per record is enforced in `ArtifactService`
--       (`upsertRecordArtifact`), not by a unique index: `artifact` is a
--       populated table, and CONVENTIONS.md rule 1 sends its index builds to
--       `concurrent/`, where UNIQUE is refused.
--
--   action_run.pinned_artifacts
--       What the human actually approved. A decision records the exact
--       artifact ids AND version numbers it acted on, so the audit answers
--       "what did they approve" rather than "what does this look like now".
--       Regeneration writes a new artifact_version; the pin keeps pointing at
--       the version that was on screen.
--
--   lead_brief.current_sequence
--       The contact's CURRENT sequence enrollment as last observed in the CRM,
--       so the page can say which of (already in this one / in another /
--       finished / an automated one we propose replacing) is true before it
--       offers an Enroll button. `status: 'unknown'` — or the column being
--       null — is the honest fourth answer, and the page refuses a one-click
--       Enroll on it rather than guessing.
--
--   lead_brief.confidence_dimensions
--       One global 0.20 collapsed five different questions. Identity,
--       acquisition, company understanding, engagement and personalization fit
--       are computed separately (`services/personalization/confidence.ts`) so
--       the recommendation engine can reason "identity known, company context
--       insufficient, engagement unavailable". `lead_brief.confidence` stays
--       as the headline reading and is unchanged.
--
-- No index is built here on a populated table: the one lookup index this
-- needs is a concurrent build in `concurrent/0112_artifact_record_index.sql`.
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "record_type" text;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "record_id" text;
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN IF NOT EXISTS "record_role" text;
--> statement-breakpoint
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "pinned_artifacts" jsonb;
--> statement-breakpoint
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "current_sequence" jsonb;
--> statement-breakpoint
ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "confidence_dimensions" jsonb;
--> statement-breakpoint
COMMENT ON COLUMN "artifact"."record_type" IS 'RecordRef.type of the record this artifact belongs to (lead, deal, briefing...). Null for a conversation-only artifact.';
--> statement-breakpoint
COMMENT ON COLUMN "artifact"."record_id" IS 'RecordRef.id of the record this artifact belongs to. Null for a conversation-only artifact.';
--> statement-breakpoint
COMMENT ON COLUMN "artifact"."record_role" IS 'What this artifact is TO its record: brief | recommendation | sequence. One artifact per (record, role); enforced in ArtifactService.upsertRecordArtifact.';
--> statement-breakpoint
COMMENT ON COLUMN "action_run"."pinned_artifacts" IS 'The exact artifact versions a human decision approved: [{artifactId, role, version, title}]. Written at decide time; never rewritten by a later regeneration.';
--> statement-breakpoint
COMMENT ON COLUMN "lead_brief"."current_sequence" IS 'The contact CURRENT sequence enrollment as last observed in the CRM: {id?, name?, status: active|completed|none|unknown, step?, totalSteps?, kind: automated|manual|unknown, disposition?: replace|add, observedAt, source}. Null = never observed, which reads as unknown and blocks a one-click Enroll.';
--> statement-breakpoint
COMMENT ON COLUMN "lead_brief"."confidence_dimensions" IS 'Per-dimension research confidence: {identity, acquisition, company, engagement, personalizationFit}, each {value: number|null, basis: string}. A null value means UNAVAILABLE, which is not the same as low.';
