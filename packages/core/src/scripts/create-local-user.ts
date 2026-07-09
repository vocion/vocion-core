import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/libs/Auth';
import { db } from '@/libs/DB';
import { accountMembershipSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import 'dotenv/config';

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
  const account = values.account
    ? accounts.find(a => a.id === values.account || a.name === values.account)
    : accounts.find(a => a.name !== 'Default') ?? accounts[0];
  if (!account) {
    console.error('no tenant_account rows exist');
    process.exit(1);
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
