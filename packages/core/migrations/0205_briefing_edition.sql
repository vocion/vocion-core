-- One personal brief per person, kind and local day (docs/guides/morning-brief.md).
-- The scheduled morning brief and evening wrap are briefings now, stored in the
-- person's Personal workspace beside the "your day" they can ask for; this key
-- (`brief:2026-10-09`, `wrap:2026-10-09`) makes a second publish that day refresh
-- the same row. Nullable with no default, so adding it rewrites nothing; lookups
-- go through the existing (org_id, created_at) index, one Personal workspace at a time.
ALTER TABLE "briefing" ADD COLUMN IF NOT EXISTS "edition" text;
