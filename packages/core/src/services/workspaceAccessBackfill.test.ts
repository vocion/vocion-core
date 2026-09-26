/**
 * The backfill runs once, and stays run.
 *
 * Production applies EVERY migration file on EVERY deploy
 * (`infra/aws/migrate.sh`: "every deploy re-runs every file"), so a data
 * migration without a guard is not a one-time backfill — it is a reconciler
 * that fires forever. This one re-granted what `people:apply` had just taken
 * away, and would have restored any direct grant an admin removed on
 * /dashboard/members on the next deploy.
 *
 * These run the real migration file rather than a copy of its SQL, so the file
 * and the guarantee cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const {
  accountMembershipSchema,
  projectMemberSchema,
  projectSchema,
  tenantAccountSchema,
  userSchema,
} = await import('@/models/Schema');
const { sql } = await import('drizzle-orm');

const ACCOUNT = 'acct-northwind';
const ALEX = 'usr-alex';
const BRIT = 'usr-brit';
const REVENUE = 'proj-revenue';
const DELIVERY = 'proj-delivery';

const MIGRATION = readFileSync(
  path.join(process.cwd(), 'migrations', '0145_workspace_access_backfill.sql'),
  'utf8',
);

/** Apply it the way the deploy does: statement by statement. */
async function runBackfill() {
  for (const stmt of MIGRATION.split('--> statement-breakpoint')) {
    const body = stmt.trim();
    if (body) {
      await db.execute(sql.raw(body));
    }
  }
}

describe('workspace access backfill', () => {
  beforeEach(async () => {
    await db.delete(projectMemberSchema);
    await db.delete(projectSchema);
    await db.delete(accountMembershipSchema);
    await db.delete(userSchema);
    await db.delete(tenantAccountSchema);

    await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind' });
    await db.insert(userSchema).values([
      { id: ALEX, email: 'alex@northwind.example' },
      { id: BRIT, email: 'brit@northwind.example' },
    ]);
    await db.insert(accountMembershipSchema).values([
      { accountId: ACCOUNT, userId: ALEX, role: 'member' },
      { accountId: ACCOUNT, userId: BRIT, role: 'admin' },
    ]);
    await db.insert(projectSchema).values([
      { id: REVENUE, accountId: ACCOUNT, slug: 'revenue', name: 'Revenue Team' },
      { id: DELIVERY, accountId: ACCOUNT, slug: 'delivery-stack', name: 'Delivery Stack' },
    ]);
  });

  it('grants every member every shared workspace at the role they hold today', async () => {
    await runBackfill();

    const rows = await db.select().from(projectMemberSchema);

    expect(rows).toHaveLength(4);
    expect(rows.filter(r => r.userId === ALEX).every(r => r.role === 'pm')).toBe(true);
    expect(rows.filter(r => r.userId === BRIT).every(r => r.role === 'owner')).toBe(true);
  });

  it('never touches a personal workspace', async () => {
    await db.insert(projectSchema).values({
      id: 'proj-personal-brit',
      accountId: ACCOUNT,
      slug: 'personal-brit',
      name: 'Brit',
      kind: 'personal',
      ownerUserId: BRIT,
    });

    await runBackfill();

    const rows = await db.select().from(projectMemberSchema);

    expect(rows.some(r => r.projectId === 'proj-personal-brit')).toBe(false);
  });

  it('does NOT restore a grant that was taken away', async () => {
    // The whole reason the guard exists. `people:apply` narrows an exclusive
    // person, or an admin clears a direct grant on the members screen — and the
    // next deploy re-runs this file.
    await runBackfill();
    await db.delete(projectMemberSchema).where(sql`user_id = ${ALEX} and project_id = ${DELIVERY}`);

    await runBackfill();

    const alex = (await db.select().from(projectMemberSchema)).filter(r => r.userId === ALEX);

    expect(alex.map(r => r.projectId)).toEqual([REVENUE]);
  });

  it('does not grant a workspace created after cutover', async () => {
    await runBackfill();
    await db.insert(projectSchema).values({ id: 'proj-new', accountId: ACCOUNT, slug: 'new', name: 'New' });

    await runBackfill();

    // Access to a new workspace is granted deliberately, by a group or by hand.
    // Handing it to everyone because a migration re-ran is not a decision.
    expect((await db.select().from(projectMemberSchema)).some(r => r.projectId === 'proj-new')).toBe(false);
  });

  it('is unchanged by running it ten more times', async () => {
    await runBackfill();
    const after = await db.select().from(projectMemberSchema);

    for (let i = 0; i < 10; i++) {
      await runBackfill();
    }

    expect(await db.select().from(projectMemberSchema)).toHaveLength(after.length);
  });
});
