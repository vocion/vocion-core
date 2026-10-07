/**
 * The index under the mailbox check, and the migration that builds it.
 *
 * `project_mailbox_address_uq` is what holds when two writers race past
 * `mailboxHolder`, so it has to refuse exactly what the check refuses: the same
 * address enabled twice, compared case-insensitively — and nothing about a
 * mailbox that is off. Migration 0178 must not take a deploy down over
 * duplicates already in the table; it skips the build and says how to fix it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { sql } = await import('drizzle-orm');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { isMailboxClaimConflict, mailboxClaimedMessage, mailboxHolder } = await import('./mailboxClaim');

const NORTHWIND = 'acct-mbxc-northwind';
const KESTREL = 'acct-mbxc-kestrel';
const ADDRESS = 'desk@agents.example.com';

const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '0178_project_mailbox_address_unique.sql'), 'utf8');
const indexExists = async () => {
  const result = await db.execute(sql`select 1 from pg_indexes where indexname = 'project_mailbox_address_uq'`);
  return result.rows.length > 0;
};

/**
 * A workspace row, mailbox on unless said otherwise.
 * @param id - Project id.
 * @param accountId - Owning account.
 * @param address - Mailbox address.
 * @param enabled - Whether the mailbox is on.
 */
function workspace(id: string, accountId: string, address: string | null, enabled = true) {
  return { id, accountId, slug: id.replace(/^proj-mbxc-/, ''), name: id, mailboxAddress: address, mailboxEnabled: enabled } as never;
}

beforeEach(async () => {
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-mbxc' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-mbxc' },
  ] as never);
});

afterEach(async () => {
  // Leave the index in place for every other file sharing this database.
  await db.delete(projectSchema);
  await db.execute(sql.raw(MIGRATION));
});

describe('project_mailbox_address_uq', () => {
  it('refuses the same enabled address twice, whatever its case, and says it is the mailbox index', async () => {
    await db.insert(projectSchema).values(workspace('proj-mbxc-one', NORTHWIND, ADDRESS));

    const second = db.insert(projectSchema).values(workspace('proj-mbxc-two', KESTREL, ADDRESS.toUpperCase()));
    const error = await second.then(() => null, (e: unknown) => e);

    expect(error).not.toBeNull();
    expect(isMailboxClaimConflict(error)).toBe(true);
  });

  it('lets any number of workspaces keep the address with the mailbox off', async () => {
    await db.insert(projectSchema).values([
      workspace('proj-mbxc-one', NORTHWIND, ADDRESS),
      workspace('proj-mbxc-two', KESTREL, ADDRESS, false),
      workspace('proj-mbxc-three', KESTREL, ADDRESS, false),
    ]);

    expect(await mailboxHolder(ADDRESS.toUpperCase(), 'proj-mbxc-two')).toEqual({ projectId: 'proj-mbxc-one', slug: 'one', accountId: NORTHWIND });
    expect(await mailboxHolder(ADDRESS, 'proj-mbxc-one')).toBeNull();
  });

  it('is not mistaken for another unique index', async () => {
    await db.insert(projectSchema).values(workspace('proj-mbxc-one', NORTHWIND, null, false));
    const error = await db.insert(projectSchema).values(workspace('proj-mbxc-one', KESTREL, null, false)).then(() => null, (e: unknown) => e);

    expect(error).not.toBeNull();
    expect(isMailboxClaimConflict(error)).toBe(false);
  });
});

describe('mailboxClaimedMessage', () => {
  const holder = { projectId: 'proj-mbxc-one', slug: 'revenue', accountId: NORTHWIND };

  it('names the holder inside the asker\'s own account', () => {
    expect(mailboxClaimedMessage(ADDRESS, holder, NORTHWIND)).toMatch(/already the mailbox of the "revenue" workspace/);
  });

  it('names nothing across accounts, or when the holder is unknown', () => {
    for (const message of [mailboxClaimedMessage(ADDRESS, holder, KESTREL), mailboxClaimedMessage(ADDRESS, null, NORTHWIND)]) {
      expect(message).toMatch(/already claimed by another workspace on this deployment/);
      expect(message).not.toMatch(/revenue/);
    }
  });
});

describe('migration 0178, re-run against existing rows', () => {
  it('is a no-op when the index is already there', async () => {
    await db.execute(sql.raw(MIGRATION));

    expect(await indexExists()).toBe(true);
  });

  it('skips the build rather than failing the deploy over duplicates, and builds it once they are gone', async () => {
    await db.execute(sql`drop index if exists "project_mailbox_address_uq"`);
    await db.insert(projectSchema).values([
      workspace('proj-mbxc-one', NORTHWIND, ADDRESS),
      workspace('proj-mbxc-two', KESTREL, ADDRESS.toUpperCase()),
    ]);

    await expect(db.execute(sql.raw(MIGRATION))).resolves.toBeDefined();
    expect(await indexExists()).toBe(false);

    await db.update(projectSchema).set({ mailboxEnabled: false }).where(sql`${projectSchema.id} = 'proj-mbxc-two'`);
    await db.execute(sql.raw(MIGRATION));

    expect(await indexExists()).toBe(true);
  });
});
