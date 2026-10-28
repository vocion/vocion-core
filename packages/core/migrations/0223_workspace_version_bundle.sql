-- An installed app follows core's new version (services/plugins/upgradeBundles.ts).
-- Each app install or upgrade records, on its version row, the hash of each
-- plugin's templates, what they shipped, and what they left in each field a
-- person may change, so the next upgrade can tell core's change from a
-- person's. Nullable, added only: folder applies and older installs have none.
ALTER TABLE "workspace_version" ADD COLUMN IF NOT EXISTS "bundle" jsonb;
