-- Per-connection ACL: {visibility: 'org' | 'restricted', users: [emails]}.
-- Null = org-wide (back-compatible default).
ALTER TABLE "knowledge_source" ADD COLUMN IF NOT EXISTS "access_policy" jsonb;
