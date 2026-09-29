/**
 * The `url` on every ask the API returns (vocion-core#128): pasted into Slack
 * or an approval file, it must open this ask's workspace on its own account,
 * so it names the account as well as the slug. Real rows in PGlite.
 */
import type { Ask } from '@/services/AskService';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
// The API's shared helpers pull in the session; nothing here signs in.
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn(), auth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { withAskUrls } = await import('./_lib');

/**
 * Just enough of an ask for its link.
 * @param id - The ask id.
 */
function ask(id: number): Ask {
  return { id } as Ask;
}

beforeEach(async () => {
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: 'acct-contoso', name: 'Contoso', slug: 'contoso' });
  await db.insert(projectSchema).values({ id: 'proj-contoso-sales', accountId: 'acct-contoso', slug: 'sales', name: 'Contoso Sales' });
});

describe('withAskUrls', () => {
  it('links each ask to its inbox page on its own workspace and account', async () => {
    const rows = await withAskUrls('proj-contoso-sales', [ask(7), ask(8)]);

    expect(rows.map(r => r.url)).toEqual([
      expect.stringMatching(/\/w\/sales\/dashboard\/inbox\/7\?account=contoso$/),
      expect.stringMatching(/\/w\/sales\/dashboard\/inbox\/8\?account=contoso$/),
    ]);
  });

  it('gives no link when the workspace is gone, rather than one that opens something else', async () => {
    const [row] = await withAskUrls('proj-deleted', [ask(7)]);

    expect(row?.url).toBeNull();
  });
});
