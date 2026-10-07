-- While one caller refreshes a login, `refreshing_until` marks the row so a
-- second caller (a sync and an agent tool at the same moment) waits for the
-- new token instead of spending the same refresh token. Zoom, PostHog and
-- Apollo rotate refresh tokens, so the second spend is refused (#1080). The
-- mark runs out on its own, so a caller that crashes never blocks the login.
-- Nullable with no default: a metadata-only change, no table rewrite.
-- Replay-safe: every deploy re-runs this file.
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "refreshing_until" timestamp;
