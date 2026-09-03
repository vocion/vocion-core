-- A Vocion-minted token can now be read back, like every other API credential.
--
-- Before this, a minted token was stored as a SHA-256 and nothing else, so the
-- plaintext existed only in the dialog that issued it. Close that dialog and the
-- token was gone: the only way to get a working token again was to revoke the
-- old one and re-issue, which breaks every integration already using it.
--
-- Minted tokens now also carry the whole token encrypted under the org's DEK —
-- the same AES-256-GCM columns a supplied third-party key uses. The secret hash
-- stays, so authenticating a request is still one hash comparison with no
-- decryption on the hot path.
--
-- This is a deliberate security tradeoff: a minted token is now only as strong
-- as the DEK protecting it, rather than being unrecoverable from a database
-- dump alone. It is the same posture the supplied keys in this table already
-- have, and it buys an admin the ability to read back a token they own.
--
-- Only the check constraint changes. Tokens issued before today keep their hash
-- and no ciphertext, which the relaxed constraint still allows; they simply
-- cannot be revealed, and the dashboard says so.

ALTER TABLE "api_token" DROP CONSTRAINT IF EXISTS "api_token_shape_ck";
--> statement-breakpoint

-- A 'vocion' row carries a secret hash plus either a complete set of encryption
-- columns (issued from now on) or none of them (issued before this migration).
-- Anything else carries ciphertext with everything needed to decrypt it and no
-- hash. A half-written row is still forbidden, because a credential that can be
-- neither verified nor decrypted does not announce itself until someone uses it.
ALTER TABLE "api_token"
  ADD CONSTRAINT "api_token_shape_ck" CHECK (
    (
      "platform" = 'vocion'
      AND "secret_hash" IS NOT NULL
      AND (
        (
          "ciphertext" IS NULL
          AND "nonce" IS NULL
          AND "auth_tag" IS NULL
          AND "dek_id" IS NULL
        )
        OR (
          "ciphertext" IS NOT NULL
          AND "nonce" IS NOT NULL
          AND "auth_tag" IS NOT NULL
          AND "dek_id" IS NOT NULL
        )
      )
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
