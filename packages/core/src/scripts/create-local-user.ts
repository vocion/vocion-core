import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

/**
 * Creates a user directly against the database, and — on an empty instance —
 * the tenant account and default project that user belongs to.
 *
 * This is how the FIRST admin of a deployment is created. The web
 * `/api/signup` route only accepts invites: it used to mint an admin for
 * whoever loaded /sign-up first on a userless instance, which made any
 * reachable deployment claimable by a stranger. Being able to run this
 * script on the box is the authorization that replaced it.
 *
 * Subsequent users are invited from inside the dashboard, so this stays a
 * bootstrap tool rather than the normal path.
 */

/**
 * Database-safe slug from a display name, matching the shape the web signup
 * route used to produce for first-run accounts.
 * @param value - Human-entered account name.
 */
function slugify(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return cleaned || 'workspace';
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
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

  const [existing] = await db.select({ id: userSchema.id }).from(userSchema).where(eq(userSchema.email, email)).limit(1);
  if (existing) {
    console.error(`user already exists: ${email} (${existing.id})`);
    process.exit(1);
  }

  const accounts = await db.select({ id: tenantAccountSchema.id, name: tenantAccountSchema.name }).from(tenantAccountSchema);
  let account = values.account
    ? accounts.find(a => a.id === values.account || a.name === values.account)
    : accounts.find(a => a.name !== 'Default') ?? accounts[0];

  // Bootstrapping a brand-new deployment: no account exists yet, so create
  // it here along with its default project. Requires --account, because the
  // name is a display value nobody else can guess for you.
  if (!account) {
    if (!values.account) {
      console.error('no tenant_account rows exist — pass --account "Your team name" to create the first one');
      process.exit(1);
    }
    const accountId = `acct-${randomUUID()}`;
    const projectId = `proj-${randomUUID()}`;
    await db.transaction(async (tx) => {
      await tx.insert(tenantAccountSchema).values({
        id: accountId,
        name: values.account!,
        slug: slugify(values.account!),
      });
      await tx.insert(projectSchema).values({
        id: projectId,
        accountId,
        slug: 'default',
        name: 'Default project',
      });
    });
    account = { id: accountId, name: values.account };
    console.log(`created account : ${values.account} (${accountId})`);
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
  console.log(`  account  : ${account.name} (${account.id})`);
  console.log(`  role     : ${role}`);
  if (!values.password) {
    console.log(`  password : ${password}    <-- generated, save this now`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
