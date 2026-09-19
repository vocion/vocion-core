-- 0122 — the browser OAuth handshake needs somewhere to keep its half.
--
-- The callback is a GET anybody can hand a signed-in browser. Without a value
-- this side minted and stored, a crafted link could make a person bind an
-- ATTACKER's Google account to their workspace, and the callback would have no
-- way to tell. So the state is a row: it says who started the flow, which
-- connector for, and holds the PKCE verifier that proves the code being
-- exchanged belongs to the same consent.
--
-- Short-lived and single-use. `consumed_at` rather than a delete, because a
-- replayed callback should be refused with something the log can explain
-- rather than read as a state that never existed.
CREATE TABLE IF NOT EXISTS "oauth_state" (
  "state" text PRIMARY KEY,
  "org_id" text NOT NULL,
  -- Who consented. The grant is written against this user for a personal
  -- connector, so it must come from the session that STARTED the flow and
  -- never from the callback's query string.
  "user_id" text NOT NULL,
  "connector_slug" text NOT NULL,
  "platform" text NOT NULL,
  "code_verifier" text,
  "scopes" text NOT NULL DEFAULT '',
  -- Where to send the browser afterwards. Validated as a same-site path at
  -- both ends; an absolute URL here would be an open redirect.
  "redirect_to" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp
);
--> statement-breakpoint

-- Sweeping expired rows. Created with the table, so it takes no lock.
CREATE INDEX IF NOT EXISTS "oauth_state_expires_idx" ON "oauth_state" USING btree ("expires_at");
