-- API tokens can now carry an expiry.
--
-- Nullable, and existing rows stay NULL: every token issued before this
-- migration keeps authenticating exactly as it did. `verifyToken` treats a
-- past `expires_at` the same way it treats `revoked_at`.
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;
