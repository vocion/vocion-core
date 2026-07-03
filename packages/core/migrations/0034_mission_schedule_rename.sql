-- Terminology: "schedule", not "heartbeat" (aligns missions with the
-- `schedule` field sources + workflow triggers already use). Guarded so it
-- works whether or not 0033's heartbeat column was ever applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mission' AND column_name = 'heartbeat')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mission' AND column_name = 'schedule') THEN
    ALTER TABLE "mission" RENAME COLUMN "heartbeat" TO "schedule";
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "mission" ADD COLUMN IF NOT EXISTS "schedule" text;
