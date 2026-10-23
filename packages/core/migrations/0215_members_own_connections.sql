-- Your connections follow you (services/outboundMcp/followingSources.ts): an `auth: person` MCP
-- server declared in any workspace of an Org is read in any turn a member starts in that Org, as
-- them, with their own sign-in. Two switches, both on by default:
--   project.members_own_connections — a workspace admin's "Members' own connections";
--   api_token.every_workspace       — a person's "Use in every workspace", on their sign-in row.
-- A constant default on a new column is a metadata change: no rewrite, no index.
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "members_own_connections" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "every_workspace" boolean DEFAULT true NOT NULL;
