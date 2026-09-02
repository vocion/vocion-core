-- The queue lane a lead lands in before any research runs, and when the lead
-- actually arrived.
--
--   1. `status` defaulted to 'ready_for_review', but the sweep records a row
--      the moment it picks a lead up, and a lead with no brief has nothing to
--      review. New default is 'queued'; the reviewable lanes are unchanged.
--   2. `arrived_at` is the CRM create date, copied at queue time. Without it
--      the only date on a row is when the sweep ran, which says nothing about
--      how fresh the lead is.
--
-- Hand-written; idempotent.
ALTER TABLE "lead_brief" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint

ALTER TABLE "lead_brief" ADD COLUMN IF NOT EXISTS "arrived_at" timestamp;
