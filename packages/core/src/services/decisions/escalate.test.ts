/**
 * THE ESCALATION RULE, IN ONE PLACE: every producer that used to put a card
 * in front of a person reaches them as the Decision it is, or — inside the
 * trust bar — as a Done receipt. Fixtures are fictional (Northwind, Kestrel
 * Capital).
 */
import type { AgentEvent } from '@/services/agents/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema } = await import('@/models/Schema');
const { escalate } = await import('./escalate');

const ORG = 'org_escalate';
const turn = { orgId: ORG, conversationId: 392, userId: 'usr-dana', agentSlug: 'revenue-lead' };

function decisionOf(out: AgentEvent[] | null) {
  const e = (out ?? []).find(x => x.type === 'decision');
  return e && e.type === 'decision' ? e.decision : null;
}

beforeEach(async () => {
  await db.delete(askSchema);
  await db.delete(actionRunSchema);
});

describe('outside trust: an approval', () => {
  it('a recommendation is an approval docked in the conversation, Approve running the action as the person', async () => {
    const out = await escalate({ type: 'recommended_action', recommendation: { actionId: 'hubspot.update', input: { objectType: 'deal', id: '4410', properties: { dealstage: 'negotiation' } }, label: 'Move Northwind to Negotiation', rationale: 'They signed the LOI.', agentSlug: 'revenue-lead', suggestedDecision: 'approve' } }, turn);
    const d = decisionOf(out);

    expect(d).toMatchObject({ kind: 'approval', question: 'Move Northwind to Negotiation', body: 'They signed the LOI.', conversationId: 392, ownerUserId: 'usr-dana', agentSlug: 'revenue-lead', state: 'open' });
    expect(d!.options.map(o => [o.id, o.recommended ?? false, o.hasEffect ?? false])).toEqual([['approve', true, true], ['reject', false, false]]);

    const [ask] = await db.select().from(askSchema);

    expect(ask!.options[0]!.action).toEqual({ id: 'hubspot.update', input: { objectType: 'deal', id: '4410', properties: { dealstage: 'negotiation' } } });
    // A permission prompt: Allow once / Deny, the exact change previewed.
    expect(d!.options.map(o => o.label)).toEqual(['Allow once', 'Deny']);
    expect(d!.preview).toBe('deal #4410\ndealstage → negotiation');
  });

  it('the agent\'s own "reject" puts Reject first', async () => {
    const d = decisionOf(await escalate({ type: 'recommended_action', recommendation: { actionId: 'gmail.send', input: { to: 'pat@northwind.example' }, label: 'Send the price list', suggestedDecision: 'reject' } }, turn));

    expect(d!.options.map(o => o.id)).toEqual(['reject', 'approve']);
  });

  it('a proposal waiting on approval is its own approval Decision — no second row', async () => {
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'gmail.send', input: { to: 'pat@northwind.example', subject: 'Renewal' }, status: 'pending', proposal: { rationale: 'Renewal is 11 days out.', suggestedDecision: 'approve', origin: { conversationId: 392 } } }).returning();
    const d = decisionOf(await escalate({ type: 'card', card: { id: 'card_1', kind: 'action', title: 'Send renewal', actions: [{ label: 'Approve', actionId: 'gmail.send', input: {}, style: 'primary' }], source: {}, runId: run!.id, state: 'filed' } }, turn));

    expect(d).toMatchObject({ id: run!.id, subject: 'proposal', kind: 'approval', state: 'open', conversationId: 392 });
    expect(d!.options.find(o => o.id === 'approve')!.consequence).toContain('it cannot be undone');
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });

  it('the approval gate is a gate Decision, its payload one move away', async () => {
    const d = decisionOf(await escalate({ type: 'hitl_gate', gate: { name: 'send-followup', question: 'Send this follow-up to Kestrel Capital?', payload: { to: 'ops@kestrel.example' } } }, turn));

    expect(d).toMatchObject({ kind: 'approval', question: 'Send this follow-up to Kestrel Capital?', options: [{ id: 'approve' }, { id: 'reject' }] });

    const [ask] = await db.select().from(askSchema);

    expect(ask!.kind).toBe('gate');
    expect(ask!.contextMd).toContain('ops@kestrel.example');
  });
});

describe('inside trust: it ran', () => {
  it('a recommendation the thread files on its trust bar and that ran is a Done receipt — Undo only where real', async () => {
    const file = vi.fn(async () => ({ runId: 88, status: 'done' }));
    const out = await escalate({ type: 'recommended_action', recommendation: { actionId: 'hubspot.update', input: {}, label: 'Move Northwind to Negotiation' } }, { ...turn, file });

    expect(out).toEqual([{ type: 'receipt', receipt: { runId: 88, actionId: 'hubspot.update', label: 'Move Northwind to Negotiation', undoable: true } }]);
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });

  it('…and one left pending is the proposal\'s own approval', async () => {
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'hubspot.update', input: {}, status: 'pending', proposal: { origin: { conversationId: 392 } } }).returning();
    const d = decisionOf(await escalate({ type: 'recommended_action', recommendation: { actionId: 'hubspot.update', input: {}, label: 'Move Northwind' } }, { ...turn, file: async () => ({ runId: run!.id, status: 'pending' }) }));

    expect(d).toMatchObject({ subject: 'proposal', id: run!.id });
  });
});

describe('an unclear instruction, several paths, a setup step', () => {
  it('Draft needed is one question — draft it here first — never filed as it stands', async () => {
    const d = decisionOf(await escalate({ type: 'recommended_action', recommendation: { actionId: 'objects.propose_candidate', input: { objectType: 'request', title: 'Export the viewer list' }, label: 'File "Export the viewer list" as a request', draft: { prompt: 'Draft the full request…', missing: 'story, acceptance' } } }, turn));

    expect(d).toMatchObject({ kind: 'question', question: 'File "Export the viewer list" as a request', body: 'Not filed yet: story, acceptance', options: [{ id: 'draft', label: 'Draft it here', recommended: true }] });
  });

  it('a ruling is a choice, each option keeping what it runs', async () => {
    const d = decisionOf(await escalate({ type: 'recommended_action', recommendation: { actionId: 'ask.file', label: 'Rule: copy-link on locked rows?', input: { title: 'Copy-link on locked rows?', kind: 'ruling', options: [{ id: 'hide', label: 'Hide on locked rows', recommended: true }, { id: 'upsell', label: 'Show with upsell', action: { id: 'objects.update_meta', input: { objectId: 7 } } }] } } }, turn));

    expect(d).toMatchObject({ kind: 'choice', question: 'Copy-link on locked rows?' });
    expect(d!.options.map(o => [o.id, o.hasEffect ?? false])).toEqual([['hide', false], ['upsell', true]]);
  });

  it('a connect card is a setup step whose options open the login or the token form, named for the connector', async () => {
    const d = decisionOf(await escalate({ type: 'card', card: { id: 'card_9', kind: 'link', title: 'Connect GitHub', actions: [], source: {}, href: '/api/connect/github/start?connector=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D392', hrefLabel: 'Connect GitHub', secondaryHref: '/dashboard/connectors?add=github&paste=1', secondaryHrefLabel: 'Paste a token', state: 'proposed' } }, turn));

    expect(d).toMatchObject({ kind: 'setup', question: 'Connect GitHub' });
    expect(d!.options).toEqual([
      expect.objectContaining({ id: 'connect:github', href: '/api/connect/github/start?connector=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D392', recommended: true }),
      expect.objectContaining({ id: 'paste:github', href: '/dashboard/connectors?add=github&paste=1' }),
    ]);
  });

  it('a recommendation with nothing to press, or a card it does not know, is no Decision', async () => {
    expect(await escalate({ type: 'recommended_action', recommendation: { actionId: '', input: {}, label: 'Talk to Pat' } }, turn)).toEqual([]);
    expect(await escalate({ type: 'card', card: { id: 'c', kind: 'record', title: 'Request #4', actions: [], source: {}, state: 'proposed' } }, turn)).toEqual([]);
    expect(await escalate({ type: 'response_delta', delta: 'hi' }, turn)).toBeNull();
  });

  it('a step whose effect has a picture (the kind says so) carries that look on the option that runs it, and its link is the other way to take it', async () => {
    const d = decisionOf(await escalate({ type: 'card', card: { id: 'card_b', kind: 'brand', title: 'Make it yours: Northwind', body: 'Read from northwind.example.', fields: [{ label: 'Note', value: 'No dark logo found.' }], actions: [{ label: 'Use this brand', actionId: 'org.brand_apply', input: { name: 'Northwind', accent: '#1f6feb' }, style: 'primary' }], source: {}, href: '/dashboard/brand?draft=x', hrefLabel: 'Adjust', state: 'proposed' } }, turn));

    expect(d).toMatchObject({ kind: 'setup', question: 'Make it yours: Northwind', body: 'Read from northwind.example. No dark logo found.' });
    expect(d!.options).toEqual([
      expect.objectContaining({ id: 'do', label: 'Use this brand', recommended: true, hasEffect: true, look: { renderer: 'brand', data: { name: 'Northwind', accent: '#1f6feb' } } }),
      expect.objectContaining({ id: 'adjust', label: 'Adjust', href: '/dashboard/brand?draft=x' }),
    ]);
  });
});

describe('a suggestion is never a Decision card (founder, 2026-10-09: "doesn\'t trap them in cards")', () => {
  it('raises nothing for the follow-ups a turn ended with', async () => {
    const out = await escalate({ type: 'suggestions', items: [{ label: 'Draft the reply to Dana', prompt: 'Draft the reply to Dana' }] }, turn);

    expect(decisionOf(out)).toBeNull();
    expect(await db.select().from(askSchema)).toHaveLength(0);
  });
});
