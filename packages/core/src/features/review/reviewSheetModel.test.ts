import type { ReviewContextModel } from '@/services/inbox/reviewContextModel';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_PANE_LABELS,
  contextPaneRows,
  decisionLegend,
  editedInputFor,
  filterContextRows,
  groupContextRows,
  hasEdits,
  planDecision,
  sheetHeadline,
  splitReviewContext,
  workCardModel,
} from './reviewSheetModel';

/**
 * The decision screen's reasoning, asserted without a DOM: which rendering a
 * payload earns, which verb the note field implies, what the header keeps
 * versus what the fold holds, and what the context pane lists for a record.
 *
 * Fixtures are fictional (Northwind, Kestrel Capital, `.example` addresses) —
 * `realDataGuard.test.ts` fails the build otherwise.
 */

const ago = (at: Date) => `${Math.round((Date.parse('2026-09-19T12:00:00.000Z') - at.getTime()) / 86_400_000)}d ago`;

describe('workCardModel — the payload renders as the thing it is', () => {
  it('renders a gmail.send payload as an email composer', () => {
    const model = workCardModel({
      actionId: 'gmail.send',
      actionKind: 'Email',
      input: { to: 'amy@northwind.example', subject: 'Following up', body: 'Hi Amy,\n\nShort note.', draft: false, baseUrl: 'https://gmail.googleapis.com/gmail/v1' },
      changes: [{ field: 'subject', to: 'Following up' }],
      email: { to: 'amy@northwind.example', cc: null, subject: 'Following up', body: 'Hi Amy,\n\nShort note.', draft: false },
    });

    expect(model.shape).toBe('email');
    expect(model).toMatchObject({ to: 'amy@northwind.example', subject: 'Following up', consequence: 'Approving sends this email.' });
  });

  it('says a draft writes a draft, so Approve reads correctly', () => {
    const model = workCardModel({
      actionId: 'gmail.send',
      actionKind: 'Email',
      input: { to: 'amy@northwind.example', body: 'Hi', draft: true },
      changes: [],
      email: { to: 'amy@northwind.example', cc: null, subject: '(no subject)', body: 'Hi', draft: true },
    });

    expect(model.consequence).toBe('Approving writes a Gmail draft. Nothing is sent.');
    expect(model.heading).toBe('Email draft');
  });

  it('renders a CRM update as a field diff, carrying the prior value when the proposer knew it', () => {
    const model = workCardModel({
      actionId: 'hubspot.update',
      actionKind: 'CRM update',
      input: { objectType: 'deals', objectId: '900112', properties: { dealstage: 'contractsent', hs_next_step: 'Send the order form' }, baseUrl: 'https://api.hubapi.com' },
      changes: [{ field: 'dealstage', from: 'presentationscheduled', to: 'contractsent' }, { field: 'hs_next_step', to: 'Send the order form' }],
      email: null,
    });

    expect(model.shape).toBe('changes');
    expect(model.shape === 'changes' && model.fields).toEqual([
      { key: 'dealstage', label: 'Deal stage', from: 'presentationscheduled', to: 'contractsent', multiline: false },
      { key: 'hs_next_step', label: 'Next step', to: 'Send the order form', multiline: false },
    ]);
    // Never plumbing: objectId, objectType and baseUrl are how the call is made,
    // not what is being decided.
    expect(JSON.stringify(model)).not.toContain('hubapi');
  });

  it('falls back to a clean field view for a kind with no idiom of its own', () => {
    const model = workCardModel({
      actionId: 'wiki.write_page',
      actionKind: 'Wiki write page',
      input: { slug: 'kestrel-capital-notes', title: 'Kestrel Capital — notes', reason: 'The call changed the plan', md: 'x'.repeat(120) },
      changes: [],
      email: null,
    });

    expect(model.shape).toBe('fields');
    expect(model.shape === 'fields' && model.fields.map(f => f.key)).toEqual(['slug', 'title', 'reason', 'md']);
    expect(model.shape === 'fields' && model.fields.at(-1)?.multiline).toBe(true);
    expect(model.consequence).toBe('Approving runs this wiki write page.');
  });

  it('never renders a blank card: an unreadable payload still shows its changes', () => {
    const model = workCardModel({ actionId: 'x.y', actionKind: 'X y', input: {}, changes: [{ field: 'stage', to: 'won' }], email: null });

    expect(model.shape === 'fields' && model.fields).toEqual([{ key: 'stage', label: 'Stage', to: 'won' }]);
  });
});

describe('editedInputFor / hasEdits — what an edited card approves with', () => {
  const email = workCardModel({
    actionId: 'gmail.send',
    actionKind: 'Email',
    input: { to: 'amy@northwind.example', subject: 'Following up', body: 'Hi Amy', draft: false, baseUrl: 'https://gmail.googleapis.com/gmail/v1' },
    changes: [],
    email: { to: 'amy@northwind.example', cc: null, subject: 'Following up', body: 'Hi Amy', draft: false },
  });

  it('is undefined when nothing was touched', () => {
    expect(editedInputFor(email, { to: 'amy@northwind.example' }, {})).toBeUndefined();
    expect(hasEdits(email, {})).toBe(false);
  });

  it('merges edits into the whole payload, because decide replaces input wholesale', () => {
    const input = { to: 'amy@northwind.example', subject: 'Following up', body: 'Hi Amy', draft: false, baseUrl: 'https://gmail.googleapis.com/gmail/v1' };

    expect(editedInputFor(email, input, { body: 'Hi Amy — shorter.' })).toEqual({ ...input, body: 'Hi Amy — shorter.' });
    expect(hasEdits(email, { body: 'Hi Amy — shorter.' })).toBe(true);
  });

  it('writes a changed field back under `properties` for a CRM update', () => {
    const model = workCardModel({
      actionId: 'hubspot.update',
      actionKind: 'CRM update',
      input: { objectType: 'deals', objectId: '900112', properties: { dealstage: 'contractsent' } },
      changes: [],
      email: null,
    });

    expect(editedInputFor(model, { objectType: 'deals', objectId: '900112', properties: { dealstage: 'contractsent' } }, { dealstage: 'closedwon' }))
      .toEqual({ objectType: 'deals', objectId: '900112', properties: { dealstage: 'closedwon' } });
  });

  it('typing a value back to what was proposed is not an edit', () => {
    expect(hasEdits(email, { body: 'Hi Amy' })).toBe(false);
  });
});

describe('planDecision — the note field is the missing "approve with direction"', () => {
  it('leaves plain Approve / Reject when the field is empty', () => {
    const plan = planDecision({ note: '', edited: false, isEmail: true, draft: false });

    expect(plan.primary).toEqual({ id: 'approve', label: 'Approve & send', shortcut: 'a' });
    expect(plan.secondary.map(v => v.id)).toEqual(['reject']);
    expect(plan.carriesNote).toBe(false);
  });

  it('says a draft writes a draft on the verb itself', () => {
    expect(planDecision({ note: '', edited: false, isEmail: true, draft: true }).primary.label).toBe('Approve → draft');
    expect(planDecision({ note: '', edited: false }).primary.label).toBe('Approve');
  });

  it('turns the primary into Approve with changes and offers Send back once there is a note', () => {
    const plan = planDecision({ note: '  shorter, and mention the July 20 call  ', edited: false, isEmail: true });

    expect(plan.primary.label).toBe('Approve with changes');
    expect(plan.primary.shortcut).toBe('a');
    expect(plan.secondary.map(v => v.id)).toEqual(['send_back', 'reject']);
    expect(plan.carriesNote).toBe(true);
  });

  it('whitespace is not direction', () => {
    const plan = planDecision({ note: '   \n ', edited: false });

    expect(plan.primary.label).toBe('Approve');
    expect(plan.secondary.map(v => v.id)).toEqual(['reject']);
  });

  it('an edited work card carries changes too, but Send back needs words', () => {
    const plan = planDecision({ note: '', edited: true });

    expect(plan.primary.label).toBe('Approve with changes');
    expect(plan.secondary.map(v => v.id)).toEqual(['reject']);
    expect(plan.hint).toContain('teaches the agent');
  });

  it('the legend names the keys that actually do something', () => {
    expect(decisionLegend(planDecision({ note: '', edited: false }), true)).toEqual([
      { key: 'a', label: 'Approve' },
      { key: 'd', label: 'Reject' },
      { key: 'j', label: 'Next' },
    ]);
    expect(decisionLegend(planDecision({ note: '', edited: false }), false).map(k => k.key)).toEqual(['a', 'd']);
  });
});

describe('splitReviewContext — the line, and what is one click behind it', () => {
  const base = {
    title: 'Email Amy Larkin — Following up on Thursday',
    kindLabel: 'Email',
    askedBy: 'revenue-lead',
    confidence: 0.65,
    index: 0,
    total: 2,
    reason: 'She replied to the pricing thread and asked for a summary.',
    runId: 41_207,
    waiting: '3d',
    earlierDecisions: 22,
  };

  it('keeps title, kind, asker, confidence and queue position on the line', () => {
    const { headline } = splitReviewContext(base);

    expect(headline).toEqual({
      title: base.title,
      kindLabel: 'Email',
      askedBy: 'revenue-lead',
      confidence: 0.65,
      position: 'Recommendation 1 of 2',
    });
  });

  it('drops the position when there is only one item', () => {
    expect(splitReviewContext({ ...base, total: 1 }).headline.position).toBeNull();
  });

  it('moves the reason, the run id, the waiting time and the earlier decisions into the fold', () => {
    const { why } = splitReviewContext(base);

    expect(why.reason).toBe(base.reason);
    expect(why.facts).toEqual([
      { label: 'Recommended by', value: 'revenue-lead' },
      { label: 'Waiting', value: '3d' },
      { label: 'Run', value: '#41207' },
      { label: 'Confidence', value: '65%' },
      { label: 'Earlier decisions', value: '22' },
    ]);
  });

  it('leaves out a fact it does not have rather than rendering an empty one', () => {
    const { why } = splitReviewContext({ ...base, askedBy: null, waiting: null, confidence: null, earlierDecisions: 0 });

    expect(why.facts).toEqual([{ label: 'Run', value: '#41207' }]);
  });
});

describe('sheetHeadline — the H1 names which thing, not what changes', () => {
  it('uses the email\'s subject', () => {
    expect(sheetHeadline({ isEmail: true, subject: 'Kestrel + Contoso intros', recordName: 'amy@northwind.example', title: 'Draft email to amy@northwind.example — Kestrel + Contoso intros' }))
      .toBe('Kestrel + Contoso intros');
  });

  it('uses the record for anything else, so the diff is not said twice', () => {
    expect(sheetHeadline({ isEmail: false, recordName: 'Northwind Traders — Q4 rollout', title: 'Update Northwind Traders — Q4 rollout — Amount: $36,000 → $48,000, Close date: 2026-10-15 → 2026-11-30 +1 more' }))
      .toBe('Northwind Traders — Q4 rollout');
  });

  it('falls back to the list\'s title rather than to nothing', () => {
    expect(sheetHeadline({ isEmail: true, subject: '  ', recordName: null, title: 'Draft email' })).toBe('Draft email');
    expect(sheetHeadline({ isEmail: false, recordName: null, title: 'Write a wiki page' })).toBe('Write a wiki page');
  });
});

describe('contextPaneRows — what the pane lists for a record', () => {
  const context: ReviewContextModel = {
    email: 'amy@northwind.example',
    contact: {
      status: 'ok',
      data: {
        hubspotId: '7721',
        name: 'Amy Larkin',
        email: 'amy@northwind.example',
        company: 'Northwind Traders',
        jobTitle: 'Head of Operations',
        lifecycleStage: 'marketingqualifiedlead',
        owner: null,
        createdAt: '2026-09-09T12:00:00.000Z',
        source: 'Organic search',
        sourceDetail: null,
        href: 'https://app.hubspot.example/contacts/1/record/0-1/7721',
      },
    },
    touches: {
      status: 'ok',
      data: [
        { direction: 'in', subject: 'Pricing for the Q4 rollout', snippet: 'Could you send the tiers?', at: '2026-09-17T12:00:00.000Z', source: 'gmail', href: '/dashboard/search?q=Pricing' },
        { direction: 'out', subject: 'Re: Pricing for the Q4 rollout', snippet: 'Here they are.', at: '2026-09-16T12:00:00.000Z', source: 'hubspot', href: null },
      ],
    },
    enrollment: { status: 'ok', data: { enrolled: true, sequenceName: 'Kestrel Capital nurture', enrolledBy: 'dana@metacto.example' } },
    warnings: ['Already in a sequence — Kestrel Capital nurture. A send on top of it is a double touch.'],
  };

  it('lists more than email: the contact, every thread, the sequence, the changes and the citations', () => {
    const pane = contextPaneRows({
      context,
      changes: [{ field: 'dealstage', from: 'presentationscheduled', to: 'contractsent' }],
      evidence: ['https://northwind.example/pricing', 'granola:6f1c2f90-0000-4000-8000-000000000001'],
      agoLabel: ago,
    });

    expect(groupContextRows(pane.rows).map(g => g.group)).toEqual(['Contact', 'Threads', 'Sequence', 'Changes', 'Documents']);
    expect(pane.rows).toHaveLength(7);
    expect(pane.warnings).toEqual(context.warnings);
  });

  it('names the lead magnet among the contact facts when the CRM carries one, and leaves it out when not', () => {
    const withMagnet: ReviewContextModel = context.contact.status === 'ok'
      ? { ...context, contact: { status: 'ok', data: { ...context.contact.data, utmContent: 'Education Industry eBook' } } }
      : context;
    const factsOf = (m: ReviewContextModel) => {
      const doc = contextPaneRows({ context: m, agoLabel: ago }).rows[0]!.doc as { facts?: Array<{ label: string; value: string }> };
      return doc.facts ?? [];
    };

    expect(factsOf(withMagnet)).toContainEqual({ label: 'Lead magnet', value: 'Education Industry eBook' });
    expect(factsOf(context).map(f => f.label)).not.toContain('Lead magnet');
  });

  it('gives every locally-known row a preview the pane can paint with no round trip', () => {
    const pane = contextPaneRows({ context, agoLabel: ago });

    expect(pane.rows.filter(r => r.doc === undefined)).toEqual([]);
    expect(pane.rows[0]!.doc).toMatchObject({ title: 'Amy Larkin', sourceLabel: 'HubSpot', externalHref: context.contact.status === 'ok' ? context.contact.data.href : null });
    expect(pane.rows[1]!.doc).toMatchObject({ sourceLabel: 'Gmail', subtitle: 'They wrote' });
    expect(pane.rows[1]!.meta).toBe('2d ago · Gmail');
  });

  it('leaves a citation to the preview registry rather than inventing a document', () => {
    const pane = contextPaneRows({ context: null, evidence: ['https://northwind.example/pricing'], agoLabel: ago });
    const row = pane.rows[0]!;

    expect(row.group).toBe('Documents');
    expect(row.doc).toBeUndefined();
    expect(row.ref).toEqual({ type: 'page', id: 'https://northwind.example/pricing' });
  });

  it('says why a section is empty instead of hiding it', () => {
    const pane = contextPaneRows({
      context: { email: 'amy@northwind.example', contact: { status: 'not-connected' }, touches: { status: 'error', message: 'missing_scope' }, enrollment: { status: 'none' }, warnings: [] },
      agoLabel: ago,
    });

    expect(pane.rows).toEqual([]);
    expect(pane.notes).toEqual(['Contact — Not connected', 'Inbox & outbox — Could not read: missing_scope', 'Sequence — None found']);
  });

  it('a deal proposal has no mailbox, so it lists what it does have', () => {
    const pane = contextPaneRows({ context: null, changes: [{ field: 'amount', to: '48000' }], agoLabel: ago });

    expect(pane.notes).toEqual([]);
    expect(pane.rows.map(r => r.title)).toEqual(['Amount']);
    // No prior value was supplied, so the preview shows the proposed value and
    // does NOT invent a "from" — a bare value never poses as a diff.
    expect(pane.rows[0]!.doc?.facts).toEqual([{ label: 'Proposed', value: '48000' }]);
  });

  it('is searchable on the row\'s own words', () => {
    const rows = contextPaneRows({ context, agoLabel: ago }).rows;

    expect(filterContextRows(rows, 'pricing').map(r => r.title)).toEqual(['Pricing for the Q4 rollout', 'Re: Pricing for the Q4 rollout']);
    expect(filterContextRows(rows, 'kestrel').map(r => r.kind)).toEqual(['sequence']);
    expect(filterContextRows(rows, '  ').map(r => r.id)).toEqual(rows.map(r => r.id));
    expect(filterContextRows(rows, 'nothing here at all')).toEqual([]);
  });
});

describe('contextPaneRows — a context that was never read', () => {
  const agoLabel = () => '2d ago';

  it('says the context has not been read when the server did not attempt it', () => {
    const pane = contextPaneRows({ context: null, contextRead: false, agoLabel });

    expect(pane.rows).toHaveLength(0);
    expect(pane.notes).toContain(CONTEXT_PANE_LABELS.notRead);
  });

  it('does not say that when a read happened and found nothing', () => {
    const pane = contextPaneRows({ context: null, contextRead: true, agoLabel });

    expect(pane.notes).not.toContain(CONTEXT_PANE_LABELS.notRead);
  });
});
