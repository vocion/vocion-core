-- What a sync read and deliberately did not keep, with the reason (a pull request
-- outside the source's branch prefix, a document yielded twice). The run already
-- reported these as progress events and dropped them, so a run that completed with
-- zero documents could not say why (Noco, 2026-09-30). Default empty: older rows
-- and an older app writing the row both read as "nothing recorded".
ALTER TABLE "source_sync_checkpoint" ADD COLUMN IF NOT EXISTS "skipped" jsonb DEFAULT '[]'::jsonb NOT NULL;
