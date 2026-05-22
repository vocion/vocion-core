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
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';

type Args = {
  email: string;
  password: string;
  name: string;
  accountName: string;
  projectSlug: string;
  projectName: string;
};

const parseArgs = (): Args => {
  const map = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]?.replace(/^--/, '');
    const value = process.argv[i + 1];
    if (key && value !== undefined) {
      map.set(key, value);
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
  return {
    email: get('email').toLowerCase(),
    password: get('password'),
    name: get('name', 'Demo User'),
    accountName: get('account-name'),
    projectSlug: get('project-slug'),
    projectName: get('project-name', map.get('account-name') ?? 'Default project'),
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
  const accountId = `acct-${randomUUID()}`;
  const projectId = `proj-${randomUUID()}`;
  const userId = `usr-${randomUUID()}`;
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
