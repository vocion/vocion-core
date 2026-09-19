-- 0120 — a personal grant belongs to the person who made it.
--
-- `source_credential.user_id` has existed since the vault landed and is
-- documented as "null for org-wide credentials; set for user-scope
-- credentials". Nothing read it. `getCredentialsForConnector` took the newest
-- non-revoked row for the install and handed it to whoever asked, so two
-- people connecting Gmail meant the second one won — for the whole workspace.
--
-- Resolution is now per identity tier (`libs/sources/types.ts`): a SHARED
-- connector still answers with the newest live row, and a PERSONAL one answers
-- with the asker's own grant, falling back to a workspace-wide row
-- (`user_id IS NULL`) and never to another member's.
--
-- Two things this migration does, both about making the existing rows mean
-- what the new rules read them as.
--
-- 1. The CLI's sentinel owners become workspace grants.
--
--    `scripts/google-oauth.ts` and `scripts/set-credential.ts` wrote
--    `'google-oauth-cli'` and `'cli'` into `user_id` — attribution, not
--    ownership, since no such user exists. Both scripts now write NULL. Left
--    as they are, every Gmail / Calendar / Drive credential an operator
--    installed would belong to a user nobody can sign in as, and would
--    therefore resolve for nobody. Named exactly, so a real user id is never
--    caught by this.
UPDATE "source_credential" SET "user_id" = NULL
  WHERE "user_id" IN ('google-oauth-cli', 'cli');
--> statement-breakpoint

-- 2. One live grant per owner, going forward.
--
--    `storeCredential` now revokes the prior live row for the same
--    (install, owner) inside the same transaction — the same shape
--    `storePlatformKey` already uses for `api_token`. That is the rule; this
--    is the one-off cleanup of rows written before it, so a fresh connect is
--    not competing with three older live rows for the same owner.
--
--    Kept to rows where `created_at` is strictly older than another live row
--    with the same (install_id, owner), so the newest grant of each owner
--    survives untouched. Revoked rather than deleted: the audit trail of what
--    an install has held is the point of keeping them.
UPDATE "source_credential" AS stale
   SET "revoked_at" = now()
  FROM "source_credential" AS newer
 WHERE stale."revoked_at" IS NULL
   AND newer."revoked_at" IS NULL
   AND stale."install_id" = newer."install_id"
   AND stale."user_id" IS NOT DISTINCT FROM newer."user_id"
   AND (stale."created_at", stale."id") < (newer."created_at", newer."id");
