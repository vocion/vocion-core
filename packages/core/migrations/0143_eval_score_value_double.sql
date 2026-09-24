-- eval_score.value: real (32-bit float) -> double precision (64-bit).
--
-- A `real` keeps about six significant digits, so a score written as 0.9 came
-- back as 0.8999999761581421 and a pass-rate display that cuts off rather than
-- rounds showed it as 89.99%. Every other pass rate in the schema is already a
-- 64-bit number (eval_run.metrics->'passRate' is JSON, eval_dataset.pass_threshold
-- is double precision), so the scores now match what they are compared with.
--
-- The cast goes through numeric on purpose. A direct real -> double cast keeps
-- the 32-bit noise (0.8999999761581421); real -> numeric prints the value to the
-- six digits a real actually holds (0.9), and numeric -> double stores that.
--
-- This is a type change in place, which migrations/CONVENTIONS.md section 2
-- normally splits into expand / contract releases. It is safe here in one step
-- because both types reach the application as a JavaScript number: code on
-- either side of the deploy reads and writes this column the same way. The cost
-- that remains is the table rewrite, which holds an ACCESS EXCLUSIVE lock on
-- eval_score for as long as the rewrite takes; score writes from a run that is
-- finishing at that moment wait for it.
--
-- Guarded on the current type so a rerun is a no-op: running the numeric cast
-- again on a double would cut it to fifteen significant digits.

DO $$
BEGIN
  IF (
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'eval_score'
      AND column_name = 'value'
  ) = 'real' THEN
    ALTER TABLE "eval_score"
      ALTER COLUMN "value" SET DATA TYPE double precision
      USING "value"::numeric::double precision;
  END IF;
END $$;
