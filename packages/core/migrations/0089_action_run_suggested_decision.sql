-- The agent's recommended decision joins the proposal envelope.
--
-- `proposal` is already jsonb, so the new `suggestedDecision` and
-- `suggestedSnoozeUntil` keys need no DDL — the shape lives in Schema.ts.
-- What does need saying is what the column now holds, because a person
-- reading the table in psql has no TypeScript to read.
--
-- The index that makes `?suggestedDecision=reject` cheap builds separately,
-- in concurrent/0089_action_run_suggested_decision_idx.sql: action_run is a
-- populated table, and a plain CREATE INDEX here would lock out every write
-- for the length of the build.
COMMENT ON COLUMN "action_run"."proposal" IS
  'Agent-proposal envelope: confidence (0-1), rationale, evidence doc uris, agentSlug, and the advisory suggestedDecision (approve | reject | snooze) with an optional suggestedSnoozeUntil timestamp. suggestedDecision never gates execution; it is compared against the human decision to measure agreement.';
