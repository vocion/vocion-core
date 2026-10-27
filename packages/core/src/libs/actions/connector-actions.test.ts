/**
 * The two new families' writes: a draft reply lands on the ticket through
 * the help-desk provider as an internal note, its words editable on the card,
 * one pending draft per ticket; an incident acknowledgement goes through the
 * pager provider and reports an incident already acknowledged as it stands.
 * Neither declares an Undo, because neither vendor allows one. The providers
 * are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const support = vi.hoisted(() => ({
  kind: 'zendesk',
  label: 'Zendesk',
  sourceSlug: 'zendesk',
  addInternalNote: vi.fn(async (id: string) => ({ noteId: '900', url: `https://northwind.zendesk.com/agent/tickets/${id}` })),
}));
const incident = vi.hoisted(() => ({
  kind: 'pagerduty',
  label: 'PagerDuty',
  sourceSlug: 'pagerduty',
  acknowledge: vi.fn(async (id: string) => (id === 'PDONE' ? { from: 'acknowledged', to: 'acknowledged', url: 'https://acme.pagerduty.example/incidents/PDONE' } : { from: 'triggered', to: 'acknowledged', url: `https://acme.pagerduty.example/incidents/${id}` })),
}));
const resolved = vi.hoisted(() => ({ opts: [] as unknown[], fail: null as string | null }));
vi.mock('@/services/support/provider', () => ({ supportProviderFor: async (_org: string, opts: unknown) => {
  resolved.opts.push(opts);
  if (resolved.fail) {
    throw new Error(resolved.fail);
  }
  return support;
} }));
vi.mock('@/services/incident/provider', () => ({ incidentProviderFor: async () => incident }));

const { supportDraftReplyAction } = await import('./support-draft-reply');
const { incidentAcknowledgeAction } = await import('./incident-acknowledge');

const ctx = { orgId: 'org_1', runId: 3, invokedBy: 'agent:support-lead' };

beforeEach(() => {
  vi.clearAllMocks();
  resolved.opts.length = 0;
  resolved.fail = null;
});

describe('support.draft_reply', () => {
  const parse = (i: Record<string, unknown>) => supportDraftReplyAction.inputSchema.parse(i);

  it('puts the draft on the ticket as an internal note and records where', async () => {
    const out = await supportDraftReplyAction.execute(ctx, parse({ ticketId: '#101', body: 'Hi Dana, the corrected invoice is attached.' }));

    expect(support.addInternalNote).toHaveBeenCalledWith('101', 'Hi Dana, the corrected invoice is attached.');
    expect(out).toMatchObject({ drafted: true, desk: 'Zendesk', ticketId: '101', noteId: '900', url: 'https://northwind.zendesk.com/agent/tickets/101' });
    expect(supportDraftReplyAction.undo).toBeUndefined();
  });

  it('keeps one pending draft per ticket, carries the words as editable copy, and refuses at the door without a desk', async () => {
    expect(supportDraftReplyAction.dedupKeyFor!(parse({ ticketId: '#101', body: 'a' }))).toBe(supportDraftReplyAction.dedupKeyFor!(parse({ ticketId: '101', body: 'b' })));

    const card = await supportDraftReplyAction.reviewCard!(ctx, parse({ ticketId: '101', body: 'Hi Dana' }));

    expect(card.content).toEqual([{ kind: 'message', id: 'body', label: 'Draft reply', body: 'Hi Dana' }]);
    expect(card.badges?.some(b => b.label === 'No Undo')).toBe(true);
    expect(supportDraftReplyAction.applyContentEdits!(parse({ ticketId: '101', body: 'Hi Dana' }), [{ id: 'body', body: 'Hello Dana' }]).body).toBe('Hello Dana');

    resolved.fail = 'This workspace has no help desk connected.';

    await expect(supportDraftReplyAction.precheck!(ctx, parse({ ticketId: '101', body: 'x' }))).resolves.toBe('This workspace has no help desk connected.');
  });
});

describe('incident.acknowledge', () => {
  it('acknowledges a triggered incident, and says so plainly when it was already acknowledged', async () => {
    const parse = (i: Record<string, unknown>) => incidentAcknowledgeAction.inputSchema.parse(i);

    await expect(incidentAcknowledgeAction.execute(ctx, parse({ incidentId: 'PT4KHLK' }))).resolves.toMatchObject({ acknowledged: true, from: 'triggered', to: 'acknowledged', line: 'Acknowledged incident PT4KHLK on PagerDuty (triggered → acknowledged).' });
    await expect(incidentAcknowledgeAction.execute(ctx, parse({ incidentId: 'PDONE' }))).resolves.toMatchObject({ line: 'Incident PDONE was already acknowledged; nothing was changed.' });
    expect(incidentAcknowledgeAction.undo).toBeUndefined();
    expect(incidentAcknowledgeAction.external).toBe(true);
  });
});
