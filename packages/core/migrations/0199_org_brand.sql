-- An Org's brand (`services/branding/OrgBrandService.ts`): the same guide a
-- workspace's brand.yaml is (`libs/workspace/brand.ts` BrandManifestSchema) —
-- name, palette and roles, fonts, logos, sender name — kept on the Org, so
-- the sidebar, the sign-in page, the favicon and outbound mail wear it, and a
-- workspace's brand.yaml inherits from it.
--
-- `brand_seeded_at` records that the one-time seed from a workspace's
-- brand.yaml ran, so it never runs twice: a person who resets the brand to
-- the default is not overruled on the next deploy.
--
-- Expand-only: two nullable columns, no default, no index. Every existing Org
-- reads NULL, which is what it is — unbranded, not yet seeded.
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "brand" jsonb;--> statement-breakpoint
ALTER TABLE "tenant_account" ADD COLUMN IF NOT EXISTS "brand_seeded_at" timestamp;
