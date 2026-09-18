-- One publisher at a time per dataset, and a run that can say why it died.
--
-- `publish_lease_until` replaces a Postgres advisory lock. The lock was taken
-- and released through the connection pool, so the two calls usually landed on
-- different backends: the release freed nothing and the dataset stayed locked
-- until that connection was recycled. A lease is a single conditional UPDATE,
-- which is atomic whichever connection runs it, and it expires, so a publish
-- that crashes mid-flight does not lock the dataset out forever.
--
-- `eval_run.error_message` is for a grader refusing the whole run — AWS denied
-- the credential, the region has no Evaluations endpoint — as opposed to cases
-- failing on their merits. Without it the run page can only show "failed".
--
-- Both are nullable added columns: no rewrite, no lock worth naming.
ALTER TABLE "eval_dataset_remote" ADD COLUMN IF NOT EXISTS "publish_lease_until" timestamp;
--> statement-breakpoint
ALTER TABLE "eval_run" ADD COLUMN IF NOT EXISTS "error_message" text;
