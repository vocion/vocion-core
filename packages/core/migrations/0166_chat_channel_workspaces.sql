-- A Slack channel is for one or more workspaces (Chris, 2026-10-05: "specific channels should get
-- (n) workspace associations to help with faster routing, but allow addition if context is
-- appropriate"). `org_id` stays the channel's first; these are the others. A thread's first
-- mention is routed among them, and a confident route elsewhere in the account adds it here
-- (services/chat/workspaceRoute.ts). A thread keeps the one workspace its first message went to.
ALTER TABLE "chat_channel_binding" ADD COLUMN IF NOT EXISTS "workspace_ids" text[] DEFAULT '{}'::text[] NOT NULL;
