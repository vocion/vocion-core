-- 0095 — artifact + canvas: what an agent RENDERS becomes data, not a URL.
--
-- Until now an "artifact" was a file under public/artifacts whose URL the
-- model pasted into prose and mission_run harvested with a regex. Nothing
-- knew which conversation produced it, what it was, or how to show it again.
-- These two tables make rendered output first-class:
--
--   artifact  one rendered thing — a table, a markdown note, a chart, a record
--             card, a link, or a file — with its typed `spec` (the card payload
--             the chat/canvas renders through libs/cards) and the conversation
--             and message that produced it. `tile` holds its slot/span on the
--             conversation's canvas; `pinned` = shown on that canvas.
--   canvas    a saved arrangement of artifacts a person named, so the working
--             view beside a conversation can be reopened later and exported as
--             a workspace page (manifesto: repeated work becomes reusable).
--
-- Both tables are new, so their indexes are declared inline (CONVENTIONS.md
-- rule 1 applies only to existing tables). `kind` is text, not an enum: a new
-- card kind is a code change, not a migration.
CREATE TABLE IF NOT EXISTS "canvas" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text REFERENCES "project"("id") ON DELETE CASCADE,
  "conversation_id" integer REFERENCES "conversation"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  "layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvas_org_updated_idx" ON "canvas" ("org_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifact" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "project_id" text REFERENCES "project"("id") ON DELETE CASCADE,
  "conversation_id" integer REFERENCES "conversation"("id") ON DELETE SET NULL,
  "message_id" integer,
  "canvas_id" integer REFERENCES "canvas"("id") ON DELETE SET NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "url" text,
  "tile" jsonb,
  "pinned" boolean DEFAULT true NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_org_conversation_idx" ON "artifact" ("org_id", "conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artifact_org_canvas_idx" ON "artifact" ("org_id", "canvas_id");
--> statement-breakpoint
COMMENT ON TABLE "artifact" IS 'One thing an agent rendered (table | markdown | chart | record | link | file): the typed card spec, the conversation/message it came from, and its tile on the canvas. Rendered through libs/cards; never a raw URL in prose.';
--> statement-breakpoint
COMMENT ON TABLE "canvas" IS 'A named, saved arrangement of artifacts beside a conversation. layout = [{artifactId, slot, span}]. Exportable as a workspace page.';
