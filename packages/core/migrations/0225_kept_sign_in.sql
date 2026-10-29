-- A kept sign-in on a connector (`services/browser/keptSignIn.ts`): the
-- browser state of the connector's site, signed in by a person and sealed
-- under the workspace's key, so the browser runs that publish to the site
-- start signed in. Squarespace refuses a password typed from a data centre.
-- Nullable, added only: every connector reads as it did.
ALTER TABLE "knowledge_source" ADD COLUMN IF NOT EXISTS "kept_sign_in" jsonb;
