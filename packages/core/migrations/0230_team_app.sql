-- The app a workspace's own team works in (`app:` in teams/<slug>.yaml, an
-- app id such as `gtm`). A team a plugin ships belongs to that plugin's app
-- without it; a workspace team that names none stays with the core app. Read
-- by an app's Chat page to scope its briefing and its counts
-- (`features/navigation/appTeams.ts`). Nullable, added only.
ALTER TABLE "team" ADD COLUMN IF NOT EXISTS "app" text;
