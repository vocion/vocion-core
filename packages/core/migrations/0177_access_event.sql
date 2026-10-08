-- 0177 — access_event: who (a person, an agent on a run, a token or a share
-- link) viewed, downloaded, exported or searched which record, and when.
--
-- Vocion Cloud hosts several companies on one deployment. A client's admin has
-- to be able to answer "who looked at this record" and "what did that agent
-- read on that run" without asking us to grep logs. Nothing recorded reads:
-- `tool_call` keeps what an agent's tools returned (truncated, and not for a
-- person), `user_activity_event` keeps adoption signals (a person's actions,
-- deduplicated per resource, so a second view of the same record is dropped by
-- design), and neither says who opened a file or a record page.
--
-- One narrow row per read. Written in batches, off the read's path
-- (`services/access/accessLog.ts`): a read never waits for this insert and a
-- failed insert never fails the read — it is retried, and logged when it is
-- finally dropped, never silently.
--
--   actor_kind   'user' | 'agent' | 'token' | 'link'
--   actor_id     the user id, the agent slug, or `token:<id>`; null for a link
--   on_behalf_of the person whose turn an agent was serving, when there was one
--   run_kind/id  the run an agent read on (`mission_run`, `conversation`)
--   action       'view' | 'export' | 'download' | 'search'
--   record_kind  the record vocabulary every surface uses (`RecordRef.type`:
--                object, artifact, document, ...); record_id null for a search
--   via          the surface: page, preview, app, api, share, tool:<name>,
--                mcp:<name>
--   ip_hash/ua_hash  keyed hashes (HMAC under AUTH_SECRET), never the address
--   detail       a small envelope (a hit count, a format), never content
--
-- `org_id` is the workspace, as on every business table; `account_id` is the
-- company that owns it, so an account-wide export or deletion can find its
-- rows without a join through a project that may already be gone.
--
-- Append-only by construction: an UPDATE is refused by the trigger below.
-- Rows leave only by age (`VOCION_ACCESS_LOG_RETENTION_DAYS`, default 365),
-- through the `access-log.prune` durable job.
--
-- Partition-friendly: the primary key carries `at`, so the table can become
-- range-partitioned by month without changing its keys, and the prune then
-- becomes a DROP of the oldest partition. Every btree leads with `org_id` and
-- ends with `at`, the shape a workspace's newest-first page reads; the BRIN on
-- `at` is what the prune's range delete walks, at a few pages for any size.
--
-- A new table, so its indexes are declared inline (CONVENTIONS.md rule 1
-- applies to tables that already exist).
CREATE TABLE IF NOT EXISTS "access_event" (
  "id" bigserial NOT NULL,
  "org_id" text NOT NULL,
  "account_id" text,
  "actor_kind" text NOT NULL,
  "actor_id" text,
  "on_behalf_of" text,
  "run_kind" text,
  "run_id" text,
  "action" text NOT NULL,
  "record_kind" text NOT NULL,
  "record_id" text,
  "via" text NOT NULL,
  "ip_hash" text,
  "ua_hash" text,
  "detail" jsonb,
  "at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "access_event_id_at_pk" PRIMARY KEY ("id", "at"),
  CONSTRAINT "access_event_action_ck" CHECK ("action" IN ('view', 'export', 'download', 'search')),
  CONSTRAINT "access_event_actor_kind_ck" CHECK ("actor_kind" IN ('user', 'agent', 'token', 'link'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_event_org_at_idx" ON "access_event" USING btree ("org_id", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_event_org_record_idx" ON "access_event" USING btree ("org_id", "record_kind", "record_id", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_event_org_actor_idx" ON "access_event" USING btree ("org_id", "actor_id", "at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_event_at_brin_idx" ON "access_event" USING brin ("at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION access_event_reject_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'access_event is append-only (row %): a read is recorded once and leaves only by age', OLD.id;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS access_event_append_only_tg ON "access_event";--> statement-breakpoint

CREATE TRIGGER access_event_append_only_tg
  BEFORE UPDATE ON "access_event"
  FOR EACH ROW
  EXECUTE FUNCTION access_event_reject_update();
