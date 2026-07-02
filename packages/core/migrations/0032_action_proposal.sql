-- Agent-proposed actions carry a proposal envelope: confidence score,
-- rationale, and evidence (doc uris) — surfaced in the review queue and the
-- daily brief so a human can judge the recommendation, and later feed the
-- trust ladder (recommended → automated).
ALTER TABLE "action_run" ADD COLUMN IF NOT EXISTS "proposal" jsonb;
