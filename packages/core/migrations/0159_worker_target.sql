-- Which runner target claimed a worker run (backlog 052): the installation's on-box backup, its
-- Fargate fleet, a laptop. Said by the runner at claim, so the Runs page names what ran the work
-- and the reconciler can tell which target stopped claiming. Nullable and new: nothing reads it
-- until the runner that writes it is deployed, and an older worker leaves it null.
ALTER TABLE "worker_run" ADD COLUMN IF NOT EXISTS "worker_target" text;
