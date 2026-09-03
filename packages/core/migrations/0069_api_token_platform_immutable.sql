-- `api_token.platform` can never change after the row is written.
--
-- Migration 0068 let a Vocion-minted token carry ciphertext so it could be
-- shown again. That had a side effect: a minted row now has exactly the column
-- shape a supplied third-party key has, plus a secret hash. So a single
-- `UPDATE api_token SET platform = 'openai', secret_hash = NULL` would turn a
-- live Vocion token into something the credential resolvers treat as the org's
-- OpenAI key — and `api_token_shape_ck` would accept it, because the rewritten
-- row is a perfectly well-formed supplied key.
--
-- Before 0068 the shape constraint refused that write on its own. This trigger
-- puts that refusal back where the constraint can no longer express it: the two
-- credential kinds are decided once, at insert, and a row never crosses over.
-- Rotation does not need this — rotating a key revokes a row and inserts a new
-- one, and neither of those is an update to `platform`.

CREATE OR REPLACE FUNCTION api_token_reject_platform_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.platform IS DISTINCT FROM OLD.platform THEN
    RAISE EXCEPTION
      'api_token.platform is immutable (row %, % -> %); revoke the credential and insert a new one instead',
      OLD.id, OLD.platform, NEW.platform;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint

DROP TRIGGER IF EXISTS api_token_platform_immutable_tg ON "api_token";

--> statement-breakpoint

CREATE TRIGGER api_token_platform_immutable_tg
  BEFORE UPDATE ON "api_token"
  FOR EACH ROW
  EXECUTE FUNCTION api_token_reject_platform_change();
