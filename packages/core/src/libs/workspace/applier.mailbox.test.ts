/**
 * One workspace per mailbox address, across every account on a deployment.
 *
 * Mail is routed by the address it was sent to, so a second workspace holding
 * an address quietly takes the first one's mail — and on a hosted deployment
 * the second may belong to another company. The default address is the slug,
 * and slugs are unique per account only, so two companies each with a
 * "revenue" workspace collide without either of them naming an address.
 *
 * The apply refuses the claim with a message naming the fix, lands every other
 * setting anyway, and names the holder only inside the asker's own account.
 * When two applies race past the check, the index from migration 0178 refuses
 * the second write and the apply says the same thing.
 *
 * A refused claim never costs a workspace the mailbox it already has: not a
 * working address it asked to move off by mistake, and not an address it
 * shares with another workspace from before the index existed — which side of
 * such a duplicate keeps its mail is a person's decision, not apply order's.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/mail/mailboxClaim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/mail/mailboxClaim')>();
  return { ...actual, mailboxHolder: vi.fn(actual.mailboxHolder) };
});

const { db } = await import('@/libs/DB');
const { eq, sql } = await import('drizzle-orm');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { mailboxHolder } = await import('@/libs/mail/mailboxClaim');

const DOMAIN = 'agents.example.com';
const NORTHWIND = 'acct-mbx-northwind';
const KESTREL = 'acct-mbx-kestrel';

const NW_REVENUE = 'proj-mbx-nw-revenue';
const NW_DELIVERY = 'proj-mbx-nw-delivery';
const KS_REVENUE = 'proj-mbx-ks-revenue';

const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '0178_project_mailbox_address_unique.sql'), 'utf8');

const dirs: string[] = [];

/**
 * A workspace directory with the given workspace.yaml body under the
 * required header.
 * @param orgId - The project it applies to.
 * @param body - The rest of workspace.yaml.
 */
function workspaceWith(orgId: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-mailbox-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${orgId}\nname: mailbox\n${body}`);
  return dir;
}

const apply = (orgId: string, body: string) => applyWorkspace(loadWorkspace(workspaceWith(orgId, body)), { orgId });

async function mailboxOf(projectId: string) {
  const [row] = await db
    .select({ enabled: projectSchema.mailboxEnabled, address: projectSchema.mailboxAddress, goal: projectSchema.goal })
    .from(projectSchema)
    .where(eq(projectSchema.id, projectId));
  return row;
}

beforeEach(async () => {
  vi.stubEnv('VOCION_MAIL_DOMAIN', DOMAIN);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values([
    { id: NORTHWIND, name: 'Northwind', slug: 'northwind-mbx' },
    { id: KESTREL, name: 'Kestrel Capital', slug: 'kestrel-mbx' },
  ] as never);
  await db.insert(projectSchema).values([
    { id: NW_REVENUE, accountId: NORTHWIND, slug: 'revenue', name: 'Revenue' },
    { id: NW_DELIVERY, accountId: NORTHWIND, slug: 'delivery', name: 'Delivery' },
    { id: KS_REVENUE, accountId: KESTREL, slug: 'revenue', name: 'Revenue' },
  ] as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('a mailbox address another workspace holds', () => {
  it('is refused inside one account, naming the holder, and every other setting still lands', async () => {
    const first = await apply(NW_REVENUE, `mailbox:\n  enabled: true\n  address: Sales@${DOMAIN}\n`);

    expect(first.errors).toEqual([]);
    expect(await mailboxOf(NW_REVENUE)).toMatchObject({ enabled: true, address: `sales@${DOMAIN}` });

    const second = await apply(NW_DELIVERY, `goal: Ship every order on time.\nmailbox:\n  enabled: true\n  address: SALES@${DOMAIN}\n`);

    expect(second.errors).toEqual([expect.objectContaining({
      resource: 'workspace',
      slug: 'workspace.yaml',
      message: expect.stringMatching(/"sales@agents\.example\.com" is already the mailbox of the "revenue" workspace.*mailbox\.address/),
    })]);
    expect(await mailboxOf(NW_DELIVERY)).toEqual({ enabled: false, address: null, goal: 'Ship every order on time.' });
    expect(await mailboxOf(NW_REVENUE)).toMatchObject({ enabled: true, address: `sales@${DOMAIN}` });
  });

  it('is refused across accounts without naming the other company\'s workspace — the default-slug collision', async () => {
    await apply(NW_REVENUE, 'mailbox:\n  enabled: true\n');

    expect(await mailboxOf(NW_REVENUE)).toMatchObject({ enabled: true, address: `revenue@${DOMAIN}` });

    const other = await apply(KS_REVENUE, 'mailbox:\n  enabled: true\n');

    expect(other.errors).toHaveLength(1);
    expect(other.errors[0]!.message).toMatch(/"revenue@agents\.example\.com" is already claimed by another workspace on this deployment/);
    expect(other.errors[0]!.message).not.toMatch(/the "revenue" workspace|Northwind/);
    expect(await mailboxOf(KS_REVENUE)).toMatchObject({ enabled: false, address: null });

    const ownAddress = await apply(KS_REVENUE, `mailbox:\n  enabled: true\n  address: kestrel-revenue@${DOMAIN}\n`);

    expect(ownAddress.errors).toEqual([]);
    expect(await mailboxOf(KS_REVENUE)).toMatchObject({ enabled: true, address: `kestrel-revenue@${DOMAIN}` });
  });

  it('is no conflict for the workspace that already holds it', async () => {
    await apply(NW_REVENUE, 'mailbox:\n  enabled: true\n');
    const again = await apply(NW_REVENUE, 'goal: Close the quarter.\nmailbox:\n  enabled: true\n');

    expect(again.errors).toEqual([]);
    expect(await mailboxOf(NW_REVENUE)).toEqual({ enabled: true, address: `revenue@${DOMAIN}`, goal: 'Close the quarter.' });
  });

  it('is free again once its holder turns the mailbox off', async () => {
    await apply(NW_REVENUE, `mailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);
    await apply(NW_REVENUE, 'mailbox:\n  enabled: false\n');
    const taken = await apply(KS_REVENUE, `mailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);

    expect(taken.errors).toEqual([]);
    expect(await mailboxOf(KS_REVENUE)).toMatchObject({ enabled: true, address: `desk@${DOMAIN}` });
  });

  it('is refused by the index when two applies race past the check, with the same message', async () => {
    await apply(NW_REVENUE, `mailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);
    // The second apply's check ran before the first one's write landed.
    vi.mocked(mailboxHolder).mockResolvedValueOnce(null);

    const raced = await apply(NW_DELIVERY, `goal: Keep the lights on.\nmailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);

    expect(raced.errors).toEqual([expect.objectContaining({
      message: expect.stringMatching(/"desk@agents\.example\.com" is already the mailbox of the "revenue" workspace/),
    })]);
    expect(await mailboxOf(NW_DELIVERY)).toEqual({ enabled: false, address: null, goal: 'Keep the lights on.' });
    expect(await mailboxOf(NW_REVENUE)).toMatchObject({ enabled: true, address: `desk@${DOMAIN}` });
  });
});

describe('a refused claim keeps the mailbox the workspace already has', () => {
  it('when it asks for an address another workspace holds, its working one stays on', async () => {
    await apply(NW_REVENUE, `mailbox:\n  enabled: true\n  address: sales@${DOMAIN}\n`);
    await apply(NW_DELIVERY, `mailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);

    const typo = await apply(NW_DELIVERY, `goal: Ship every order on time.\nmailbox:\n  enabled: true\n  address: sales@${DOMAIN}\n`);

    expect(typo.errors).toEqual([expect.objectContaining({
      message: expect.stringMatching(/"sales@agents\.example\.com" is already the mailbox of the "revenue" workspace/),
    })]);
    expect(await mailboxOf(NW_DELIVERY)).toEqual({ enabled: true, address: `desk@${DOMAIN}`, goal: 'Ship every order on time.' });
    expect(await mailboxOf(NW_REVENUE)).toMatchObject({ enabled: true, address: `sales@${DOMAIN}` });
  });

  it('when the index refuses it in a race, its working one stays on', async () => {
    await apply(NW_REVENUE, `mailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);
    await apply(NW_DELIVERY, `mailbox:\n  enabled: true\n  address: shipping@${DOMAIN}\n`);
    vi.mocked(mailboxHolder).mockResolvedValueOnce(null);

    const raced = await apply(NW_DELIVERY, `goal: Keep the lights on.\nmailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);

    expect(raced.errors).toEqual([expect.objectContaining({ message: expect.stringMatching(/"desk@agents\.example\.com" is already the mailbox/) })]);
    expect(await mailboxOf(NW_DELIVERY)).toEqual({ enabled: true, address: `shipping@${DOMAIN}`, goal: 'Keep the lights on.' });
  });

  it('when a duplicate from before the index is re-applied, the incumbent keeps its mail and hears about the conflict', async () => {
    // A deployment where 0178 skipped its index: two companies already share
    // an address, and either one may be where mail is landing today.
    await db.execute(sql`drop index if exists "project_mailbox_address_uq"`);
    try {
      for (const id of [NW_REVENUE, KS_REVENUE]) {
        await db.update(projectSchema).set({ mailboxEnabled: true, mailboxAddress: `desk@${DOMAIN}` }).where(eq(projectSchema.id, id));
      }

      const reapplied = await apply(KS_REVENUE, `goal: Close the quarter.\nmailbox:\n  enabled: true\n  address: desk@${DOMAIN}\n`);

      expect(reapplied.errors).toEqual([expect.objectContaining({
        resource: 'workspace',
        message: expect.stringMatching(/"desk@agents\.example\.com" is already claimed by another workspace on this deployment.*mailbox\.address/),
      })]);
      expect(await mailboxOf(KS_REVENUE)).toEqual({ enabled: true, address: `desk@${DOMAIN}`, goal: 'Close the quarter.' });
      expect(await mailboxOf(NW_REVENUE)).toMatchObject({ enabled: true, address: `desk@${DOMAIN}` });
    } finally {
      // Settle the duplicate and put the index back for the tests after this one.
      await db.update(projectSchema).set({ mailboxEnabled: false }).where(eq(projectSchema.id, KS_REVENUE));
      await db.execute(sql.raw(MIGRATION));
    }
  });
});
