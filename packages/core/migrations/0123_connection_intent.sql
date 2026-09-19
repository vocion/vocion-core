-- 0123 — the turn that showed the card is the turn that answers.
--
-- Resume v1 re-sent the question once the grant landed, which works because the
-- tool surface is rebuilt per turn: the same question now reaches the real tool
-- instead of the stub. It costs a second model turn, and it trusts the model to
-- ask itself the same thing twice — a slightly different question gets a
-- slightly different answer, and the person watching has no idea why.
--
-- It doesn't need to guess. When the stub fired, the model had already decided
-- exactly what to call and with what: `list_events` with
-- `{ timeMin: …T00:00, timeMax: …T23:59 }`. Those args are the intent. Saved
-- here and replayed on the grant, the turn resumes with no re-asking at all.
--
-- Short-lived (`expires_at`) because an intent is about a conversation in
-- progress, and single-use (`consumed_at`) because replaying one twice would
-- run the same read twice for one decision.
CREATE TABLE IF NOT EXISTS "connection_intent" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  -- Who the replay runs as. A personal credential resolves for a person, so an
  -- intent belongs to one, and it is read back from here rather than from
  -- whoever happens to be holding the callback.
  "user_id" text NOT NULL,
  "conversation_id" integer,
  "connector_slug" text NOT NULL,
  "tool" text NOT NULL,
  -- Exactly what the model was about to call it with.
  "args" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- What the card asked consent for, so a replay can say whether the grant it
  -- got actually covers the call it is about to make.
  "scopes" text DEFAULT '' NOT NULL,
  -- The question that produced it — what resume falls back to when the exact
  -- call can no longer be made (the tool was renamed, the agent changed).
  "message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp
);
--> statement-breakpoint

-- "the live intent for this conversation and this person", which is the only
-- question asked of it. Created with the table, so it takes no lock.
CREATE INDEX IF NOT EXISTS "connection_intent_lookup_idx"
  ON "connection_intent" USING btree ("org_id", "user_id", "conversation_id", "created_at");
