-- GitHub through a Vocion GitHub App (backlog 053).
--
-- `github_app` is the deployment's app, created by GitHub's app-manifest flow
-- from Connections: its id, slug and client id in the clear, and its private
-- key, webhook secret and client secret as ONE vault-encrypted JSON blob
-- (`credentialVault`, under the deployment's own DEK, org id
-- `deployment:github-app`). Nobody copies a key by hand.
--
-- `github_installation` binds an installation of that app (a GitHub org or
-- user and the repositories its owner chose) to a workspace. One GitHub
-- account holds one installation per app, so two workspaces on the same org
-- share an installation id: the key is (org, installation). Tokens are never
-- stored: an installation token is minted per call from the app key, lives an
-- hour, and is cached in process until five minutes before it expires.
--
-- Both tables are new, so their indexes are built here (CONVENTIONS.md rule 1
-- applies to tables that already exist).

CREATE TABLE IF NOT EXISTS "github_app" (
  "id" serial PRIMARY KEY NOT NULL,
  "app_id" bigint NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "client_id" text NOT NULL,
  "owner_login" text,
  "html_url" text,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "secret_nonce" text NOT NULL,
  "secret_auth_tag" text NOT NULL,
  "secret_dek_id" integer NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_app_app_id_uq" ON "github_app" ("app_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "github_installation" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "app_id" bigint NOT NULL,
  "installation_id" bigint NOT NULL,
  "account_login" text NOT NULL,
  "account_type" text,
  "repository_selection" text DEFAULT 'selected' NOT NULL,
  "repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tier" text DEFAULT 'base' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_error" text,
  "connected_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "github_installation_org_installation_uq" ON "github_installation" ("org_id", "installation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "github_installation_installation_idx" ON "github_installation" ("installation_id");
