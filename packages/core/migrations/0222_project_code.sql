-- Projects read as projects: PRJ-12, not DR-12. A project's type kept the
-- slug it had as a data room (`data_room`), and with no code declared its
-- code was derived from that slug. The type now declares PRJ; this moves the
-- rows already holding the derived DR. A workspace that chose its own code
-- keeps it, and one where PRJ already names another type is left alone. Old
-- DR-12 links still resolve (`resolveCode` accepts a type's derived code).
UPDATE "business_object_type" AS t
SET "schema" = jsonb_set(COALESCE(t."schema", '{}'::jsonb), '{x-code}', '"PRJ"')
WHERE t."slug" = 'data_room'
  AND COALESCE(t."schema"->>'x-code', 'DR') = 'DR'
  AND NOT EXISTS (
    SELECT 1 FROM "business_object_type" AS other
    WHERE other."org_id" = t."org_id" AND other."id" <> t."id" AND other."schema"->>'x-code' = 'PRJ'
  );
