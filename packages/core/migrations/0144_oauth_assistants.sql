-- Sign in from an assistant (backlog 027).
--
-- Claude.ai, ChatGPT and their kin add a workspace by URL and expect to sign
-- the person in with OAuth 2.1: the client registers itself, the person
-- approves it in the app, and the code it gets back becomes a Vocion API
-- token. Two small tables carry that: the clients that registered, and the
-- sign-in attempts in flight. Ported from Slate's connector (2026-09-25).
CREATE TABLE IF NOT EXISTS "oauth_client" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_request" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "state" text,
  "scope" text,
  "user_id" text,
  "org_id" text,
  "code" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_request_code_idx" ON "oauth_request" USING btree ("code");
