ALTER TABLE "source_sync_checkpoint" ADD COLUMN "failures" jsonb DEFAULT '[]'::jsonb NOT NULL;
