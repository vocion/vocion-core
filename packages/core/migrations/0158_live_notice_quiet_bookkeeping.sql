-- 0158 — a record write that changes nothing a person reads publishes nothing.
--
-- The `business_object` trigger (0155) published a live notice on EVERY row
-- update. On 2026-09-30 22:35–22:39 request #269 was written thirteen times —
-- the designer re-writing its "drawing, attempt 2" mark (`visuals.mockupDraw`),
-- the same values twice, the mockup job stamping it — and every notice made
-- the open feature page re-read itself: "I keep getting refreshed every few
-- seconds" (Chris).
--
-- Now an UPDATE is compared first. The row before and after, less
-- `updated_at` and less every metadata path the record's TYPE declares as
-- bookkeeping (`schema -> 'x-bookkeeping'`, a list of dot paths — the same key
-- `libs/workspace/bookkeeping.ts` reads for `object.updated` and record body
-- versions). Equal, and there is nothing to hear: no notice. No path or type
-- is named here; the type row says which paths are its own.
--
-- INSERT and DELETE publish as before. CREATE OR REPLACE on the function the
-- trigger already calls: no table is locked or rewritten. Hand-written;
-- idempotent.
CREATE OR REPLACE FUNCTION live_notice_business_object()
RETURNS trigger AS $$
DECLARE
  r record;
  type_slug text;
  quiet jsonb;
  before_row jsonb;
  after_row jsonb;
  path text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT t.slug, t.schema -> 'x-bookkeeping' INTO type_slug, quiet FROM "business_object_type" t WHERE t.id = r.type_id;
  IF TG_OP = 'UPDATE' THEN
    before_row := to_jsonb(OLD) - 'updated_at';
    after_row := to_jsonb(NEW) - 'updated_at';
    IF jsonb_typeof(quiet) = 'array' THEN
      FOR path IN SELECT jsonb_array_elements_text(quiet) LOOP
        before_row := before_row #- (ARRAY['metadata'] || string_to_array(path, '.'));
        after_row := after_row #- (ARRAY['metadata'] || string_to_array(path, '.'));
      END LOOP;
    END IF;
    IF before_row = after_row THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM live_notice_emit(
    r.org_id,
    CASE WHEN type_slug IS NULL THEN ARRAY['record:' || r.id] ELSE ARRAY['record:' || r.id, 'list:' || type_slug] END,
    'record:' || r.id,
    live_notice_kind(TG_OP)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
