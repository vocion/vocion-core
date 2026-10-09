-- One Personal per person (services/personal/reach.ts). A person's Personal
-- reads across every Org they belong to; an Org whose contract forbids that
-- aggregation turns this off, and its items then reach Personal only as counts
-- with links, never content. On by default, like personal_connections (0202).
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "include_in_personal" boolean DEFAULT true NOT NULL;
