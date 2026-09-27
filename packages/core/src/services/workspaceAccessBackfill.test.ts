/**
 * The 0145 backfill re-runs on every deploy, and has to survive 0146.
 *
 * `infra/aws/migrate.sh` applies every .sql file on every deploy and sorts
 * real errors from already-applied ones by message, so an idempotent backfill
 * running forever is the design. 0146 pinned `project_member_role_ck` to
 * ('admin','member'), which made 0145's 'owner'/'pm' illegal — and the next
 * deploy that found a new (member, shared workspace) pair to insert failed the
 * migration step and refused the container swap (2026-09-27).
 *
 * The unit suite could not have caught it before this: it applies each
 * migration once, against empty tables, where the INSERT matches no rows and
 * passes whatever it would have written. This seeds first, then re-runs the
 * file the way production does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const BACKFILL = readFileSync(
  join(process.cwd(), 'migrations', '0145_workspace_access_backfill.sql'),
  'utf8',
);

const ACCOUNT = 'acct-backfill';

/** Run the migration file exactly as the production applier does: whole, again. */
async function rerunBackfill() {
  await db.execute(sql.raw(BACKFILL));
}

describe('0145 backfill, re-run against a populated database', () => {
  beforeEach(async () => {
    await db.delete(projectMemberSchema);
    await db.delete(accountMembershipSchema);
    await db.delete(projectSchema);
    await db.delete(userSchema);
    await db.delete(tenantAccountSchema);

    await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Northwind', slug: 'northwind-backfill' });
    await db.insert(userSchema).values([
      { id: 'usr-bf-alex', email: 'alex@northwind.example' },
      { id: 'usr-bf-cass', email: 'cass@northwind.example' },
    ]);
    await db.insert(accountMembershipSchema).values([
      { accountId: ACCOUNT, userId: 'usr-bf-alex', role: 'member' },
      { accountId: ACCOUNT, userId: 'usr-bf-cass', role: 'admin' },
    ]);
    await db.insert(projectSchema).values([
      { id: 'prj-bf-rev', accountId: ACCOUNT, slug: 'bf-revenue', name: 'Revenue', kind: 'shared' },
      { id: 'prj-bf-own', accountId: ACCOUNT, slug: 'bf-personal', name: 'Alex', kind: 'personal', ownerUserId: 'usr-bf-alex' },
    ]);
  });

  it('writes the vocabulary the CHECK actually accepts', async () => {
    await rerunBackfill();

    const rows = await db.select().from(projectMemberSchema);

    expect(rows.map(r => r.role).sort()).toEqual(['admin', 'member']);
  });

  it('does not touch personal workspaces', async () => {
    await rerunBackfill();

    const rows = await db.select().from(projectMemberSchema);

    expect(rows.every(r => r.projectId === 'prj-bf-rev')).toBe(true);
  });

  it('survives a second run that has a genuinely new pair to insert', async () => {
    // The production failure exactly: the backfill had already run, somebody
    // new joined, and the next deploy re-ran the file with a row to write.
    await rerunBackfill();
    await db.insert(userSchema).values({ id: 'usr-bf-drew', email: 'drew@northwind.example' });
    await db.insert(accountMembershipSchema).values({ accountId: ACCOUNT, userId: 'usr-bf-drew', role: 'member' });

    await expect(rerunBackfill()).resolves.not.toThrow();

    const rows = await db.select().from(projectMemberSchema);

    expect(rows).toHaveLength(3);
    expect(rows.find(r => r.userId === 'usr-bf-drew')?.role).toBe('member');
  });

  it('is idempotent — running it twice changes nothing', async () => {
    await rerunBackfill();
    const first = await db.select().from(projectMemberSchema);
    await rerunBackfill();
    const second = await db.select().from(projectMemberSchema);

    expect(second).toEqual(first);
  });

  it('leaves a grant somebody has since edited alone', async () => {
    await rerunBackfill();
    await db.update(projectMemberSchema).set({ role: 'admin' }).where(sql`user_id = 'usr-bf-alex'`);

    await rerunBackfill();

    const alex = (await db.select().from(projectMemberSchema)).find(r => r.userId === 'usr-bf-alex');

    // ON CONFLICT DO NOTHING: a person's decision outranks the machine default.
    expect(alex?.role).toBe('admin');
  });
});
