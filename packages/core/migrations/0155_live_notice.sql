-- 0155 — live_notice: the workspace live stream's ring and its doorbell (backlog 050).
--
-- Server changes never reached a browser. The only push was the per-turn chat
-- stream, buffered in the app process, so it could not hear the temporal
-- worker, which is where most factory changes are written. Every other surface
-- polled: manifest pages every 15s, the feature page every 5s, microcards
-- every 4s.
--
-- A notice is a small row saying WHAT changed, never the change itself:
-- `{topics, ref, kind}`. A browser following one of its topics re-reads
-- through the typed read that already exists, so shape and permission stay in
-- one place. Every notice is a row here, and the AFTER INSERT trigger rings
-- `pg_notify('vocion_live', …)` with it: NOTIFY is delivered only on commit,
-- to every process listening on this database — the app containers and the
-- worker alike — with no new infrastructure. The rows are the ring a
-- reconnecting tab replays from (`Last-Event-ID`); the app prunes them after
-- an hour (`libs/live/hub.ts`).
--
-- The writers that change what a person sees publish BY TRIGGER, not by a call
-- at each site: records (business_object), cards (action_run), worker runs,
-- agent runs (mission_run), asks, artifacts and events. Those tables are
-- written from forty-odd places across two processes; a trigger is in the
-- writer's own transaction by construction, and a new write site cannot forget
-- to publish. Anything that is not a row change on one of these tables calls
-- `publish()` in `libs/live/publish.ts`, which inserts here too.
--
-- Topics are `<noun>:<id>` for one thing and a bare noun for a workspace feed:
--   record:<id>  list:<type slug>      a record, and every record of its type
--   card:<id>    cards                 an action run (a card)
--   run:<id>     runs                  a worker run; an agent run joins `runs`
--   mission:<id>                       an agent run
--   ask:<id>     asks                  an ask
--   artifact:<id>                      an artifact, and its record's topic
--   events                             every event emitted
-- A worker run also names the record its input is for (`input.record.id`),
-- and an artifact the record it belongs to, so a record's page hears its
-- runs and its evidence. No type slug appears here: the slug in `list:` is
-- read from the record's own type row.
--
-- A new table, so its indexes are declared inline (CONVENTIONS.md rule 1
-- applies to tables that already exist). CREATE TRIGGER on the existing
-- tables takes a brief SHARE ROW EXCLUSIVE lock and does not scan or rewrite.
CREATE TABLE IF NOT EXISTS "live_notice" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "topics" text[] NOT NULL,
  "ref" text NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_notice_org_id_idx" ON "live_notice" ("org_id", "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_notice_created_idx" ON "live_notice" ("created_at");--> statement-breakpoint

-- The doorbell. The payload is the notice itself, so a listener delivers it
-- without a read; one past NOTIFY's 8000-byte limit carries only its id and
-- org, and the listener reads the row.
CREATE OR REPLACE FUNCTION live_notice_ring()
RETURNS trigger AS $$
DECLARE
  payload text;
BEGIN
  payload := json_build_object('id', NEW.id, 'orgId', NEW.org_id, 'topics', NEW.topics, 'ref', NEW.ref, 'kind', NEW.kind, 'at', NEW.created_at)::text;
  IF octet_length(payload) > 7900 THEN
    payload := json_build_object('id', NEW.id, 'orgId', NEW.org_id)::text;
  END IF;
  PERFORM pg_notify('vocion_live', payload);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS live_notice_ring_tg ON "live_notice";--> statement-breakpoint
CREATE TRIGGER live_notice_ring_tg
  AFTER INSERT ON "live_notice"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_ring();--> statement-breakpoint

-- One notice. A row with no org says nothing anybody may hear.
CREATE OR REPLACE FUNCTION live_notice_emit(p_org text, p_topics text[], p_ref text, p_kind text)
RETURNS void AS $$
BEGIN
  IF p_org IS NULL OR p_topics IS NULL OR cardinality(p_topics) = 0 THEN
    RETURN;
  END IF;
  INSERT INTO "live_notice" ("org_id", "topics", "ref", "kind") VALUES (p_org, p_topics, p_ref, p_kind);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- What a change is: created, changed or deleted.
CREATE OR REPLACE FUNCTION live_notice_kind(op text)
RETURNS text AS $$
  SELECT CASE op WHEN 'INSERT' THEN 'created' WHEN 'DELETE' THEN 'deleted' ELSE 'changed' END;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

-- A record: its own topic, and its type's list.
CREATE OR REPLACE FUNCTION live_notice_business_object()
RETURNS trigger AS $$
DECLARE
  r record;
  type_slug text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT t.slug INTO type_slug FROM "business_object_type" t WHERE t.id = r.type_id;
  PERFORM live_notice_emit(
    r.org_id,
    CASE WHEN type_slug IS NULL THEN ARRAY['record:' || r.id] ELSE ARRAY['record:' || r.id, 'list:' || type_slug] END,
    'record:' || r.id,
    live_notice_kind(TG_OP)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS business_object_live_tg ON "business_object";--> statement-breakpoint
CREATE TRIGGER business_object_live_tg
  AFTER INSERT OR UPDATE OR DELETE ON "business_object"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_business_object();--> statement-breakpoint

-- A card.
CREATE OR REPLACE FUNCTION live_notice_action_run()
RETURNS trigger AS $$
BEGIN
  PERFORM live_notice_emit(NEW.org_id, ARRAY['card:' || NEW.id, 'cards'], 'card:' || NEW.id, live_notice_kind(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS action_run_live_tg ON "action_run";--> statement-breakpoint
CREATE TRIGGER action_run_live_tg
  AFTER INSERT OR UPDATE ON "action_run"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_action_run();--> statement-breakpoint

-- A worker run, and the record its input says it is for.
CREATE OR REPLACE FUNCTION live_notice_worker_run()
RETURNS trigger AS $$
DECLARE
  record_id text;
  topics text[];
BEGIN
  topics := ARRAY['run:' || NEW.id, 'runs'];
  record_id := NEW.input #>> '{record,id}';
  IF record_id ~ '^[0-9]{1,18}$' THEN
    topics := topics || ('record:' || record_id);
  END IF;
  PERFORM live_notice_emit(NEW.org_id, topics, 'run:' || NEW.id, live_notice_kind(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS worker_run_live_tg ON "worker_run";--> statement-breakpoint
CREATE TRIGGER worker_run_live_tg
  AFTER INSERT OR UPDATE ON "worker_run"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_worker_run();--> statement-breakpoint

-- An agent run.
CREATE OR REPLACE FUNCTION live_notice_mission_run()
RETURNS trigger AS $$
BEGIN
  PERFORM live_notice_emit(NEW.org_id, ARRAY['mission:' || NEW.id, 'runs'], 'mission:' || NEW.id, live_notice_kind(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS mission_run_live_tg ON "mission_run";--> statement-breakpoint
CREATE TRIGGER mission_run_live_tg
  AFTER INSERT OR UPDATE ON "mission_run"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_mission_run();--> statement-breakpoint

-- An ask.
CREATE OR REPLACE FUNCTION live_notice_ask()
RETURNS trigger AS $$
BEGIN
  PERFORM live_notice_emit(NEW.org_id, ARRAY['ask:' || NEW.id, 'asks'], 'ask:' || NEW.id, live_notice_kind(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS ask_live_tg ON "ask";--> statement-breakpoint
CREATE TRIGGER ask_live_tg
  AFTER INSERT OR UPDATE ON "ask"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_ask();--> statement-breakpoint

-- An artifact (a new head version moves `current_version` on this row), and
-- the record it belongs to when it belongs to one.
CREATE OR REPLACE FUNCTION live_notice_artifact()
RETURNS trigger AS $$
DECLARE
  topics text[];
BEGIN
  topics := ARRAY['artifact:' || NEW.id];
  IF NEW.record_type = 'object' AND NEW.record_id ~ '^[0-9]{1,18}$' THEN
    topics := topics || ('record:' || NEW.record_id);
  END IF;
  PERFORM live_notice_emit(NEW.org_id, topics, 'artifact:' || NEW.id, live_notice_kind(TG_OP));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS artifact_live_tg ON "artifact";--> statement-breakpoint
CREATE TRIGGER artifact_live_tg
  AFTER INSERT OR UPDATE ON "artifact"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_artifact();--> statement-breakpoint

-- An event, named by its type.
CREATE OR REPLACE FUNCTION live_notice_event_log()
RETURNS trigger AS $$
BEGIN
  PERFORM live_notice_emit(NEW.org_id, ARRAY['events'], 'event:' || NEW.id, NEW.type);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS event_log_live_tg ON "event_log";--> statement-breakpoint
CREATE TRIGGER event_log_live_tg
  AFTER INSERT ON "event_log"
  FOR EACH ROW
  EXECUTE FUNCTION live_notice_event_log();
