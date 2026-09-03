-- API credentials can now belong to any platform, not just Vocion.
--
-- Before this migration every `api_token` row was a Vocion-minted token: we
-- generated the secret and stored only its SHA-256. That shape cannot hold a
-- key the customer supplies (their OpenAI or Anthropic key), because we have to
-- be able to read those back to call out with them.
--
-- So the table gains a `platform` discriminator and a second, encrypted shape —
-- the same AES-256-GCM columns `source_credential` already uses, under the same
-- per-org DEK. `secret_hash` becomes nullable because a supplied key has none.
--
-- Existing rows are untouched: `platform` defaults to 'vocion' and every column
-- added here is nullable, so every token issued before today keeps working.

ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "platform" text DEFAULT 'vocion' NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "dek_id" integer;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "ciphertext" text;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "nonce" text;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "auth_tag" text;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "key_hint" text;

--> statement-breakpoint
-- A supplied key has no secret hash. Existing rows all have one, so dropping
-- the constraint cannot invalidate anything already stored.
ALTER TABLE "api_token" ALTER COLUMN "secret_hash" DROP NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "api_token"
    ADD CONSTRAINT "api_token_dek_id_source_dek_id_fk"
    FOREIGN KEY ("dek_id") REFERENCES "source_dek"("id") ON DELETE RESTRICT;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- The two shapes must never mix. A 'vocion' row carries a secret hash and no
-- ciphertext; anything else carries ciphertext (with its nonce, tag and DEK)
-- and no secret hash. Enforced in the database because a half-written row here
-- is a credential that either cannot be verified or cannot be decrypted.
DO $$
BEGIN
  ALTER TABLE "api_token"
    ADD CONSTRAINT "api_token_shape_ck" CHECK (
      (
        "platform" = 'vocion'
        AND "secret_hash" IS NOT NULL
        AND "ciphertext" IS NULL
        AND "dek_id" IS NULL
      )
      OR (
        "platform" <> 'vocion'
        AND "secret_hash" IS NULL
        AND "ciphertext" IS NOT NULL
        AND "nonce" IS NOT NULL
        AND "auth_tag" IS NOT NULL
        AND "dek_id" IS NOT NULL
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- One live credential per third-party platform per org. This is what lets
-- "resolve the org's OpenAI key" be a single row rather than a guess between
-- several. Revoked rows drop out of the index, so rotation is: revoke the old
-- key, store the new one. Vocion tokens are excluded — an org is meant to hold
-- as many of those as it has integrations.
CREATE UNIQUE INDEX IF NOT EXISTS "api_token_org_platform_live_idx"
  ON "api_token" ("org_id", "platform")
  WHERE "revoked_at" IS NULL AND "platform" <> 'vocion';
