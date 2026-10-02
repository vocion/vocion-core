#!/usr/bin/env tsx
/**
 * Seed a demo user + tenant_account + project so a vocion-demos instance
 * boots with a working sign-in flow.
 *
 * Idempotent: re-running is safe. If a user with the given email already
 * exists, this exits 0 without changes.
 *
 * Used by vocion-demos/demos/<slug>/scripts/dev.sh before `npm run dev`.
 *
 * Usage:
 *   tsx src/scripts/seed-demo.ts \
 *     --email demo@example.com \
 *     --password demo123 \
 *     --name "Demo User" \
 *     --account-name "Support Demo" \
 *     --project-slug support-demo \
 *     --project-name "Support reply demo"
 */
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { projectSlugProblem } from '@/libs/links';
import { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';

type Args = {
  email: string;
  password: string;
  name: string;
  accountName: string;
  projectSlug: string;
  projectName: string;
  /** Ids derived from the slugs and the email instead of drawn at random. */
  stableIds: boolean;
};

const parseArgs = (): Args => {
  const map = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i]?.replace(/^--/, '');
    const value = process.argv[i + 1];
    if (!key) {
      continue;
    }
    // A bare flag (`--stable-ids`) has no value; everything else is a pair.
    if (value === undefined || value.startsWith('--')) {
      flags.add(key);
    } else {
      map.set(key, value);
      i += 1;
    }
  }
  const get = (k: string, fallback?: string) => {
    const v = map.get(k) ?? fallback;
    if (v === undefined) {
      console.error(`Missing required argument: --${k}`);
      process.exit(2);
    }
    return v;
  };
  const projectSlug = get('project-slug');
  // The slug becomes a path segment (`/w/<slug>/…`, docs/routing.md), so a
  // reserved or malformed one would make the workspace unreachable. Say so
  // here rather than at the reader's 404.
  const problem = projectSlugProblem(projectSlug);
  if (problem) {
    console.error(`--project-slug "${projectSlug}" ${problem}`);
    process.exit(2);
  }
  return {
    email: get('email').toLowerCase(),
    password: get('password'),
    name: get('name', 'Demo User'),
    accountName: get('account-name'),
    projectSlug,
    projectName: get('project-name', map.get('account-name') ?? 'Default project'),
    stableIds: flags.has('stable-ids'),
  };
};

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'workspace';

async function main() {
  const args = parseArgs();

  // Idempotency: existing user with same email → exit 0, no changes.
  const [existing] = await db
    .select({ id: userSchema.id })
    .from(userSchema)
    .where(eq(userSchema.email, args.email))
    .limit(1);
  if (existing) {
    console.log(`✓ User already exists (${args.email}). No changes.`);
    process.exit(0);
  }

  const accountSlug = slugify(args.accountName);
  // --stable-ids: the same inputs give the same ids, so a database rebuilt
  // from them keeps every session valid — a session names a user and a
  // project by id, and a demo box that reseeds on every deploy signed every
  // signed-in tablet out when those ids changed (2026-10-02). The ids are
  // UUID-shaped (v5-style, from a SHA-256) so nothing downstream can tell.
  const stable = (kind: string, key: string) => {
    const h = createHash('sha256').update(`vocion-seed:${kind}:${key}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const accountId = `acct-${args.stableIds ? stable('account', accountSlug) : randomUUID()}`;
  const projectId = `proj-${args.stableIds ? stable('project', `${accountSlug}/${args.projectSlug}`) : randomUUID()}`;
  const userId = `usr-${args.stableIds ? stable('user', args.email) : randomUUID()}`;
  const passwordHash = await hashPassword(args.password);

  await db.transaction(async (tx) => {
    // tenant_account: reuse if a row with the same slug already exists
    // (e.g. created by an earlier seed against the same DB or by the
    // backfill migration). Otherwise create it.
    const [existingAccount] = await tx
      .select({ id: tenantAccountSchema.id })
      .from(tenantAccountSchema)
      .where(eq(tenantAccountSchema.slug, accountSlug))
      .limit(1);
    const finalAccountId = existingAccount?.id ?? accountId;
    if (!existingAccount) {
      await tx.insert(tenantAccountSchema).values({
        id: accountId,
        name: args.accountName,
        slug: accountSlug,
      });
    }

    // project: same idempotent pattern, scoped by account
    const [existingProject] = await tx
      .select({ id: projectSchema.id })
      .from(projectSchema)
      .where(eq(projectSchema.slug, args.projectSlug))
      .limit(1);
    const finalProjectId = existingProject?.id ?? projectId;
    if (!existingProject) {
      await tx.insert(projectSchema).values({
        id: projectId,
        accountId: finalAccountId,
        slug: args.projectSlug,
        name: args.projectName,
      });
    }

    // user: known to not exist (we checked above)
    await tx.insert(userSchema).values({
      id: userId,
      name: args.name,
      email: args.email,
      passwordHash,
    });

    // membership: admin of the account
    await tx.insert(accountMembershipSchema).values({
      accountId: finalAccountId,
      userId,
      role: 'admin',
    });

    console.log(`✓ Seeded demo:`);
    console.log(`  account:    ${finalAccountId} (${args.accountName})`);
    console.log(`  project:    ${finalProjectId} (${args.projectSlug})`);
    console.log(`  user:       ${userId} (${args.email})`);
    console.log(`  role:       admin`);
  });

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
