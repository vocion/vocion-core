-- 0121 — who a shared artifact opens for.
--
-- "Copy link" handed out a dashboard URL that only worked for a signed-in
-- member; a proposal a client should read, or a brief a founder wants to keep
-- to themselves, had no way to say so. Chris, 2026-09-18: *"choose whether I
-- need to be me, in the Revenue Team workspace, or anyone that can see it."*
--
--   me         only the person who chose it (share_owner_id)
--   workspace  any signed-in member — the default, and what every row was
--   anyone     read-only through a signed link (libs/share/artifactShareToken.ts)
--
-- Additive and defaulted: nothing changes for a row nobody touched.
ALTER TABLE "artifact"
  ADD COLUMN IF NOT EXISTS "share_audience" text NOT NULL DEFAULT 'workspace';
--> statement-breakpoint
ALTER TABLE "artifact"
  ADD COLUMN IF NOT EXISTS "share_owner_id" text;
