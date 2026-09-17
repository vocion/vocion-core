-- Discovery Ledger v2 — name the meaning of a stored confidence, and stop
-- pretending old rows have one.
--
-- The v1 classifier prompt asked for `is_discovery_confidence` and never said
-- whether it meant "probability this is a discovery call" or "confidence in the
-- answer I just gave". Both readings are defensible from that prompt and both
-- appear in the data. Every row written under it is therefore marked
-- 'legacy': its verdict is readable, its number is not.
--
-- Deliberately NOT a conversion. Rewriting a historical score under a guessed
-- reading would corrupt the audit record this ledger exists to be, and there is
-- no evidence in the row that says which reading produced it.
--
-- Additive and idempotent: two nullable columns plus a backfill of rows that
-- already carry a classification.

ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "confidence_semantics" text;
--> statement-breakpoint
ALTER TABLE "discovery_candidate" ADD COLUMN IF NOT EXISTS "reason_code" text;
--> statement-breakpoint

-- Rows already assessed pre-date the contract. `reason_code` stays null: v1 had
-- no reason codes and inventing one is exactly what the closed set forbids.
UPDATE "discovery_candidate"
   SET "confidence_semantics" = 'legacy'
 WHERE "classification" IS NOT NULL
   AND "confidence_semantics" IS NULL;
