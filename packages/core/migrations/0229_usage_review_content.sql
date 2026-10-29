-- The daily usage review (docs/guides/usage-review.md): whether it may read
-- this Org's chat content to judge whether each thread got the person where
-- they wanted. Nullable on purpose: NULL follows the deployment's default
-- (VOCION_USAGE_REVIEW_DEFAULT — on for Vocion Cloud, off when unset, so a
-- self-hosted install starts with it off); true or false is an Org admin's
-- own choice and wins. Off means the review reads metadata only.
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "usage_review_content" boolean;
