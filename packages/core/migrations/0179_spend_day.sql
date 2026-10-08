-- What each workspace spent on models, one row per UTC day.
--
-- `agent_budget` answers "how much this period", and a period's counter is
-- zeroed when the period rolls, so it cannot answer "how much in the last 30
-- days" — the number an operator running several client accounts on one
-- deployment reads first. Every charge (`BudgetService.chargeUsage`) now also
-- adds to today's row here, in the same transaction as the budget counters, so
-- the two cannot disagree about a charge that landed.
--
-- `org_id` is the workspace (`project.id`), like every other `org_id` column,
-- and carries no foreign key for the same reason `agent_budget.org_id` does
-- not: a charge must never fail because of what it is charged to. An account's
-- spend is the sum over its workspaces, read at the time.
--
-- Expand-only: a new table, created with its primary key, nothing else
-- touched. The ledger starts empty — spend before this migration is not
-- reconstructed, and the operator console says from which day it counts.
CREATE TABLE IF NOT EXISTS "spend_day" (
  "org_id" text NOT NULL,
  "day" date NOT NULL,
  "tokens" bigint DEFAULT 0 NOT NULL,
  "micro_cents" bigint DEFAULT 0 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "spend_day_pk" PRIMARY KEY ("org_id", "day")
);
