-- "Since you last looked" needs a per-viewer, per-page memory of when the
-- viewer last looked. That is a sidebar-shaped preference (one small row per
-- (org, user), whole-value writes), so it joins `user_nav_pref` rather than
-- taking a table of its own.
--
-- `page_seen` maps a page slug to the ISO instant that person last opened it:
-- {"factory": "2026-09-21T14:02:11.000Z"}. A slug missing from the map means
-- that person has never opened the page, and the overview archetype says so
-- in the panel heading instead of quietly showing a 24-hour window as if it
-- were their own memory.
--
-- ADD COLUMN with a constant default does not rewrite the table in Postgres
-- 11 and later, so this is safe on a populated table and needs no concurrent
-- build (CONVENTIONS.md rule 1 is about indexes; none is added here).
ALTER TABLE "user_nav_pref" ADD COLUMN IF NOT EXISTS "page_seen" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN "user_nav_pref"."page_seen" IS 'Page slug -> ISO timestamp this person last opened that page. Absent slug = never opened; surfaces must say so rather than substitute a default window.';
