-- eval_run is a pre-existing table, so this index builds here, outside the
-- transactional migration (CONVENTIONS.md rule 1).
--
-- Deliberately NOT unique, though one run per (run_group_id, provider) is
-- exactly the rule the application holds to. A unique index cannot live in
-- this directory — dev and the tests never build it, so they would accept
-- rows production rejects — and it cannot live in the numbered migration
-- either, because building one on a populated table locks it. Until eval_run
-- is worth an expand-and-contract pass, the guarantee is enforced in code:
-- `createProviderRun` and `createPrimaryRun` look the run up by its group and
-- reuse it. Two live attempts of the same activity could still both insert;
-- the cost of that is one duplicate point on a trend line, not lost data.
DROP INDEX IF EXISTS "eval_run_group_provider_idx";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "eval_run_group_provider_idx"
  ON "eval_run" ("run_group_id", "provider");
