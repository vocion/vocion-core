-- One grader per dataset.
--
-- An eval belongs in one place: it is either scored by Vocion's own judge or
-- by AWS AgentCore, and the workspace file says which. Runs still carry their
-- own provider — history from before this column keeps whatever graded it —
-- but a new run only ever uses the dataset's grader.
--
-- Existing rows default to `vocion`, which is what every dataset used before
-- AgentCore existed.
ALTER TABLE "eval_dataset" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'vocion' NOT NULL;
