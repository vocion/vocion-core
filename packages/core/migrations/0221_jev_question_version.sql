-- Jev health (ADR 0006): every logged Jev decision says which wording of the
-- question it answered. Routing decisions carry it in their JSON detail; the
-- duplicate check's rows get a column. Additive; older rows stay null.
ALTER TABLE "record_duplicate_check" ADD COLUMN IF NOT EXISTS "question_version" text;
