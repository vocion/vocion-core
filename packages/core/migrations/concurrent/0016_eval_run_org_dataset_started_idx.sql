-- Applied outside a transaction by infra/aws/apply-migrations.sh, straight
-- after the numbered 0016 that creates `eval_run` with all three columns.
--
-- The dataset page reads a dataset's runs by period (#647): the paged list,
-- the trend chart and the summary all filter on org and dataset and range on
-- `started_at`, and until now `eval_run` had no index for any of it. The table
-- already exists and takes writes from every run, so the build is concurrent.
--
-- The DROP clears an INVALID index left behind by a build that died partway:
-- `IF NOT EXISTS` alone would then skip the retry forever.
DROP INDEX IF EXISTS "eval_run_org_dataset_started_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "eval_run_org_dataset_started_idx"
  ON "eval_run" USING btree ("org_id", "dataset_id", "started_at");
