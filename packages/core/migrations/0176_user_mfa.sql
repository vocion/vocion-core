-- Sign-in fit for client data, part two: a second factor (TOTP).
--
-- `user_mfa` is one person's authenticator. The shared secret is encrypted
-- with the credential vault (`libs/crypto/credentialVault.ts`) under the scope
-- `user:<id>`, the same AES-256-GCM columns `api_token` and
-- `source_credential` use, so on KMS the secret is wrapped by KMS like every
-- other credential. `enabled_at` is null while enrolment is unconfirmed: the
-- secret exists but sign-in does not ask for it until the person has proved
-- their app reads it. `last_used_step` is the 30-second TOTP step last
-- accepted, so a code that was seen once (over a shoulder, in a proxy log)
-- cannot be replayed inside its own window.
--
-- `user_mfa_recovery_code` holds the one-time codes shown once at enrolment.
-- Each is 40 random bits, so its SHA-256 is stored rather than a slow hash; a
-- used code keeps its row with `used_at` set, which is how the profile page
-- counts what is left.
--
-- `tenant_account.require_mfa` is the account-level switch: when it is on,
-- everyone in that account enrols at their next sign-in before they reach a
-- workspace. `VOCION_REQUIRE_MFA=1` is the same switch for a whole deployment.
-- A boolean with a constant default is a metadata-only change on Postgres 11+,
-- so it neither rewrites nor locks the table (CONVENTIONS.md rule 2).

CREATE TABLE IF NOT EXISTS "user_mfa" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "dek_id" integer NOT NULL REFERENCES "source_dek"("id") ON DELETE RESTRICT,
  "ciphertext" text NOT NULL,
  "nonce" text NOT NULL,
  "auth_tag" text NOT NULL,
  "enabled_at" timestamp,
  "last_used_step" bigint,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_mfa_recovery_code" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "code_hash" text NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_mfa_recovery_code_user_idx" ON "user_mfa_recovery_code" ("user_id");--> statement-breakpoint

ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "require_mfa" boolean DEFAULT false NOT NULL;
