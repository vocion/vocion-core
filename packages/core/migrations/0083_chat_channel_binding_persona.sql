-- 0083 — chat_channel_binding: the persona a channel's replies wear (brief H-012).
--
-- One Slack app is the doorway; `chat:write.customize` lets a single
-- `chat.postMessage` set `username` and `icon_url` per call, so the reply in
-- #revenue can arrive from "Sterling Banks" with Sterling's avatar while the
-- install stays one app and one secret. A persona therefore costs a row and an
-- image, not an app registration.
--
-- Both columns are nullable on purpose: a binding without them posts exactly as
-- it does today (the adapter omits the fields rather than sending nulls), so
-- existing installs see no change. Nullable ADD COLUMN is metadata-only —
-- expand, per CONVENTIONS.md rule 2, with no backfill and nothing to contract.
--
-- Hand-written; idempotent.
ALTER TABLE "chat_channel_binding" ADD COLUMN IF NOT EXISTS "display_name" text;--> statement-breakpoint
ALTER TABLE "chat_channel_binding" ADD COLUMN IF NOT EXISTS "icon_url" text;
