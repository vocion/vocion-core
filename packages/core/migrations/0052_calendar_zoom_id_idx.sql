-- Partial index for the discovery sweep's Zoom-id ↔ calendar-event join.
-- That lookup is deliberately NOT time-windowed (an invite is normally
-- ingested well before its recording, and sharing the recordings' window made
-- such calls permanently unreadable), so without an index the hourly sweep
-- seq-scans knowledge_document — a table that grows with every synced mail and
-- doc. Partial, so it stays small: only calendar events carrying a Zoom id.
-- Hand-written; idempotent.
CREATE INDEX IF NOT EXISTS "knowledge_document_calendar_zoom_id_idx"
  ON "knowledge_document" ("org_id", (("metadata"->>'zoomMeetingId')))
  WHERE "metadata"->>'kind' = 'calendar-event' AND "metadata"->>'zoomMeetingId' IS NOT NULL;
