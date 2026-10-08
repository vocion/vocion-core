import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { ensureWorkspaceLead } from '@/services/workspace/workspaceLead';
import 'dotenv/config';

/**
 * The body of `create-local-user`, shared with the E2E fixture seeder
 * (`tests/support/create-e2e-user.ts`). The two differ in one thing only: who
 * decides whether a new Org may be created. The operator's script asks the
 * Org policy (`services/OrgPolicy.ts`, single-Org by default); the fixture
 * seeder, like every other test fixture, is exempt, because the E2E suite
 * holds many Orgs in one database to test isolation between them.
 */

/** Whether a new Org may be created: null when it may, else the sentence to print. */
export type NewOrgCheck = () => Promise<string | null>;

/**
 * Database-safe slug from a display name, matching the shape the web signup
 * route used to produce for first-run accounts.
 * @param value - Human-entered account name.
 */
function slugify(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return cleaned || 'workspace';
}

/**
 * Parse the command line, then create the user (and, when it is new, its Org
 * and default project). Exits the process on a refusal.
 * @param newOrgCheck - Whether a new Org may be created.
 */
export async function createLocalUser(newOrgCheck: NewOrgCheck): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      // `--org` is the name people use; `--account` is kept for existing runbooks.
      org: { type: 'string' },
      account: { type: 'string' },
      password: { type: 'string' },
      role: { type: 'string', default: 'admin' },
    },
  });

  const email = values.email?.toLowerCase();
  if (!email) {
    console.error('missing --email');
    process.exit(2);
  }
  const name = values.name ?? email.split('@')[0]!;
  const role = (values.role === 'member' ? 'member' : 'admin') as 'admin' | 'member';
  const orgName = values.org ?? values.account;

  const [existing] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  if (existing) {
    console.error(`user already exists: ${email} (${existing.id})`);
    process.exit(1);
  }

  const accounts = await db.select({ id: tenantAccountSchema.id, name: tenantAccountSchema.name }).from(tenantAccountSchema);
  let account = orgName
    ? accounts.find(a => a.id === orgName || a.name === orgName)
    : accounts.find(a => a.name !== 'Default') ?? accounts[0];

  // Bootstrapping a brand-new deployment: no Org exists yet (or, on a
  // multi-Org server, the one named is new), so create it here along with its
  // default project. Requires --org, because the name is a display value
  // nobody else can guess for you.
  if (!account) {
    if (!orgName) {
      console.error('no Org exists yet — pass --org "Your team name" to create the first one');
      process.exit(1);
    }
    const refusal = await newOrgCheck();
    if (refusal) {
      console.error(refusal);
      process.exit(1);
    }
    const accountId = `acct-${randomUUID()}`;
    const projectId = `proj-${randomUUID()}`;
    await db.transaction(async (tx) => {
      await tx.insert(tenantAccountSchema).values({
        id: accountId,
        name: orgName,
        slug: slugify(orgName),
      });
      await tx.insert(projectSchema).values({
        id: projectId,
        accountId,
        slug: 'default',
        name: 'Default project',
      });
    });
    // A new workspace opens on its lead, not on an empty chat.
    await ensureWorkspaceLead(projectId);
    account = { id: accountId, name: orgName };
    console.log(`created Org     : ${orgName} (${accountId})`);
  }

  const password = values.password ?? randomBytes(12).toString('base64url');
  const passwordHash = await hashPassword(password);
  const userId = `usr-${randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.insert(userSchema).values({ id: userId, name, email, passwordHash });
    await tx.insert(accountMembershipSchema).values({ accountId: account.id, userId, role }).onConflictDoNothing();
  });

  console.log(`created user`);
  console.log(`  id       : ${userId}`);
  console.log(`  email    : ${email}`);
  console.log(`  name     : ${name}`);
  console.log(`  org      : ${account.name} (${account.id})`);
  console.log(`  role     : ${role}`);
  if (!values.password) {
    console.log(`  password : ${password}    <-- generated, save this now`);
  }
}
