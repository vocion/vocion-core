/**
 * The CRM family's writes: `crm.update_record` records what it overwrote and
 * Undo writes it back to the same source; `crm.add_note` puts the words on
 * the card as an editable message, and Undo deletes the note. Both are
 * external and need the `update_crm` grant. The provider is mocked; the
 * records are invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  kind: 'pipedrive',
  sourceSlug: 'pipedrive-sales',
  updateRecord: vi.fn(async () => ({ previous: { title: 'Contoso rollout' }, url: 'https://northwind.pipedrive.com/deal/70' })),
  addNote: vi.fn(async () => ({ id: '95', url: 'https://northwind.pipedrive.com/deal/70' })),
  deleteNote: vi.fn(async () => {}),
}));
const resolved = vi.hoisted(() => ({ args: [] as unknown[] }));
vi.mock('@/services/crm/provider', () => ({ crmProviderFor: async (_org: string, opts: unknown) => {
  resolved.args.push(opts);
  return provider;
} }));

const { crmUpdateRecordAction } = await import('./crm-update-record');
const { crmAddNoteAction } = await import('./crm-add-note');
const { getAction } = await import('./registry');

const CTX = { orgId: 'org_northwind' };

beforeEach(() => {
  resolved.args.length = 0;
});

describe('crm.update_record', () => {
  it('is registered, external, and needs the update_crm grant', () => {
    expect(getAction('crm.update_record')).toBe(crmUpdateRecordAction);
    expect(crmUpdateRecordAction).toMatchObject({ external: true, grant: 'update_crm' });
  });

  it('refuses an update that names no field', () => {
    expect(crmUpdateRecordAction.inputSchema.safeParse({ object: 'deal', id: '70', fields: {} }).success).toBe(false);
  });

  it('records what it overwrote, and Undo writes it back to the same source', async () => {
    const input = crmUpdateRecordAction.inputSchema.parse({ object: 'deal', id: '70', fields: { title: 'Contoso rollout, phase 1' }, record_name: 'Contoso rollout' });
    const result = await crmUpdateRecordAction.execute(CTX, input);

    expect(provider.updateRecord).toHaveBeenLastCalledWith('deal', '70', { title: 'Contoso rollout, phase 1' });
    expect(result).toMatchObject({ source: 'pipedrive-sales', previous: { title: 'Contoso rollout' }, line: 'Updated title on Contoso rollout in pipedrive.' });

    await crmUpdateRecordAction.undo!(CTX, input, result);

    expect(provider.updateRecord).toHaveBeenLastCalledWith('deal', '70', { title: 'Contoso rollout' });
    expect(resolved.args.at(-1)).toEqual({ sourceSlug: 'pipedrive-sales' });
  });

  it('says so when there is nothing to restore', async () => {
    const input = crmUpdateRecordAction.inputSchema.parse({ object: 'deal', id: '70', fields: { title: 'x' } });

    await expect(crmUpdateRecordAction.undo!(CTX, input, { previous: null })).rejects.toThrow(/nothing to restore/);
  });

  it('shows each field it will set on the card, and a cleared one as cleared', async () => {
    const input = crmUpdateRecordAction.inputSchema.parse({ object: 'contact', id: '60', fields: { job_title: 'COO', phone: null } });
    const card = await crmUpdateRecordAction.reviewCard!(CTX, input);

    expect(card.fields).toEqual([{ label: 'Record', value: 'contact 60' }, { label: 'job_title', value: 'COO' }, { label: 'phone', value: '(cleared)' }]);
  });
});

describe('crm.add_note', () => {
  it('logs the note, and Undo deletes it', async () => {
    const input = crmAddNoteAction.inputSchema.parse({ object: 'deal', id: '70', text: 'Budget approved.', title: 'Call summary' });
    const result = await crmAddNoteAction.execute(CTX, input);

    expect(provider.addNote).toHaveBeenCalledWith('deal', '70', { title: 'Call summary', text: 'Budget approved.' });
    expect(result).toMatchObject({ noteId: '95', source: 'pipedrive-sales' });

    await crmAddNoteAction.undo!(CTX, input, result);

    expect(provider.deleteNote).toHaveBeenCalledWith('95');
  });

  it('puts the words on the card to edit, and takes the edit back into the note', async () => {
    const input = crmAddNoteAction.inputSchema.parse({ object: 'account', id: '50', text: 'Draft words.' });
    const card = await crmAddNoteAction.reviewCard!(CTX, input);

    expect(card.content).toEqual([{ kind: 'message', id: 'note', label: 'Note', body: 'Draft words.' }]);
    expect(crmAddNoteAction.applyContentEdits!(input, [{ id: 'note', body: 'Edited words.' }]).text).toBe('Edited words.');
  });
});
