/**
 * close_record (conversations 417–422): "Close FE-318 as already fixed" and
 * "retire REPO-312" go through `objects.close` with the record's own type, as
 * the person's action when their words say so (`saidToDecide`), and the
 * record a reason names is passed by its id.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const consent = vi.hoisted(() => ({ said: true }));
vi.mock('../turnJudge', async (importOriginal) => {
  const real = await importOriginal<typeof import('../turnJudge')>();
  return { ...real, saidToDecide: vi.fn(async () => ({ said: consent.said, quote: null })) };
});
vi.mock('@/services/codes', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/codes')>()),
  resolveCode: vi.fn(async (_org: string, text: string) => (text === 'TK-41'
    ? { kind: 'record', id: 41, typeSlug: 'ticket', code: 'TK-41', title: 'Northwind sign-in fails' }
    : text === 'TK-40'
      ? { kind: 'record', id: 40, typeSlug: 'ticket', code: 'TK-40', title: 'Northwind image build' }
      : { kind: 'none', reason: `no record ${text} in this workspace` })),
}));
vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({ runId: 61, status: 'done', outcome: 'created', result: { record: { objectType: 'ticket', id: 41 } } })),
}));

const { proposeAction } = await import('@/services/ActionService');
const { closeRecordTool } = await import('./closeRecord');

const ctx = { orgId: 'org_close_tool', userId: 'usr-qa', agentSlug: 'product-manager', conversationId: 9, connectorSources: [], objectTypeSlugs: [], turnMessage: 'Close TK-41 as already fixed', emit: () => {} } as unknown as RuntimeContext;

describe('close_record', () => {
  beforeEach(() => {
    vi.mocked(proposeAction).mockClear();
  });

  it('closes the record by its own type, as the person, when they said so', async () => {
    consent.said = true;

    const out = await closeRecordTool(ctx).invoke({ id: 'TK-41', close_as: 'duplicate', note: 'Same fix as TK-40.', ref: 'TK-40' });

    expect(vi.mocked(proposeAction).mock.calls[0]![0]).toMatchObject({
      actionId: 'objects.close',
      input: { objectType: 'ticket', id: 41, closeAs: 'duplicate', note: 'Same fix as TK-40.', ref: 40 },
      principal: { kind: 'user', id: 'usr-qa' },
    });
    expect(out).toContain('as the person asked');
  });

  it('is the agent\'s own proposal when the person did not say so', async () => {
    consent.said = false;

    await closeRecordTool(ctx).invoke({ id: 'TK-41', close_as: 'fixed_elsewhere', note: 'Looks fixed.' });

    expect(vi.mocked(proposeAction).mock.calls[0]![0]).toMatchObject({ principal: { kind: 'agent' } });
  });

  it('says which record it could not find, and proposes nothing', async () => {
    const out = await closeRecordTool(ctx).invoke({ id: 'TK-999', close_as: 'fixed_elsewhere', note: 'x' });

    expect(out).toMatch(/^Not closed: no record TK-999/);
    expect(proposeAction).not.toHaveBeenCalled();
  });
});
