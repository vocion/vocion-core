import { describe, expect, it } from 'vitest';
import { amountLabel, confidenceLabel, describeActionRun, firstSentence, humaniseField, recordTitle } from './describeActionRun';

const base = { id: 1, invokedBy: 'agent:revenue-lead' as string | null };

describe('describeActionRun', () => {
  it('hubspot.update on a deal: names the deal, lists the changes with old → new when known, reads the amount', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'hubspot.update',
      input: { objectType: 'deals', objectId: '7781', properties: { dealname: 'Northwind renewal', dealstage: 'contractsent', hs_next_step: 'Send MSA', amount: '48000' } },
      proposal: { confidence: 0.82, rationale: 'The MSA went out on the 12th; the stage still says proposal.', agentSlug: 'deal-desk', before: { dealstage: 'presentationscheduled' } },
    });

    expect(d.title).toBe('Update Northwind renewal — Deal stage: presentationscheduled → contractsent, Next step: Send MSA, Amount: $48,000');
    expect(d.subline).toBe('CRM update › proposed by deal-desk');
    expect(d.record).toEqual({ kind: 'deal', key: 'hubspot:deals:7781', name: 'Northwind renewal', idLabel: 'Deal 7781', fromId: false });
    expect(d.changes.map(c => c.field)).toEqual(['dealstage', 'hs_next_step', 'amount']);
    expect(d.changes[0]).toEqual({ field: 'dealstage', from: 'presentationscheduled', to: 'contractsent' });
    expect(d.amount).toBe(48000);
    expect(d.currency).toBe('USD');
    expect(d.confidence).toBe(0.82);
    expect(d.agentSlug).toBe('deal-desk');
  });

  it('hubspot.update on a contact with no name falls back to the id, and the agent comes from invokedBy', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'hubspot.update',
      input: { objectType: 'contacts', objectId: '88201', properties: { lifecyclestage: 'salesqualifiedlead' } },
      proposal: { confidence: 0.6 },
    });

    expect(d.title).toBe('Update Contact 88201 — Lifecycle stage: salesqualifiedlead');
    expect(d.record?.key).toBe('hubspot:contacts:88201');
    expect(d.record?.fromId).toBe(true);
    expect(d.record?.idLabel).toBe('Contact 88201');
    // The id is not passed off as a name.
    expect(recordTitle(d.record!)).toBe('Contact 88201 (name not synced)');
    expect(d.agentSlug).toBe('revenue-lead');
    expect(d.amount).toBeNull();
  });

  it('a name the workspace knows replaces an id-derived one, in the title and on the record', () => {
    const run = {
      ...base,
      actionId: 'hubspot.update',
      input: { objectType: 'deals', objectId: '900112', properties: { closedate: '2026-11-30' } },
      proposal: { confidence: 0.7 },
    } as const;

    const bare = describeActionRun(run);

    expect(bare.title).toBe('Update Deal 900112 — Close date: 2026-11-30');
    expect(recordTitle(bare.record!)).toBe('Deal 900112 (name not synced)');

    const named = describeActionRun(run, { recordNames: new Map([['hubspot:deals:900112', 'Northwind renewal']]) });

    expect(named.title).toBe('Update Northwind renewal — Close date: 2026-11-30');
    expect(named.record).toEqual({ kind: 'deal', key: 'hubspot:deals:900112', name: 'Northwind renewal', idLabel: 'Deal 900112', fromId: false });
    expect(recordTitle(named.record!)).toBe('Northwind renewal');
  });

  it('a name the proposer actually wrote is never overwritten by the mirror', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'hubspot.update',
      input: { objectType: 'deals', objectId: '900112', properties: { dealname: 'Northwind renewal (2027)' } },
      proposal: null,
    }, { recordNames: new Map([['hubspot:deals:900112', 'Northwind renewal']]) });

    expect(d.record?.name).toBe('Northwind renewal (2027)');
  });

  it('personalization.enroll: contact, company and sequence; keyed on the contact ref', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'personalization.enroll',
      input: { leadBriefId: 3, contactRef: 'contacts:88201', contactName: 'Jamie Smith', companyName: 'Contoso Supply', sequenceId: 's1', sequenceName: 'MSP triage nurture', senderEmail: 'sender@example.test', sends: [] },
      proposal: { confidence: 0.88, agentSlug: 'personalization' },
    });

    expect(d.title).toBe('Enroll Jamie Smith (Contoso Supply) in MSP triage nurture');
    expect(d.subline).toBe('Enrollment › proposed by personalization');
    expect(d.record).toEqual({ kind: 'contact', key: 'hubspot:contacts:88201', name: 'Jamie Smith (Contoso Supply)' });
    expect(d.actionKind).toBe('Enrollment');
  });

  it('gmail.send: recipient and subject; a draft says so; keyed on the address, case-folded', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'gmail.send',
      input: { to: 'Jane@Example.test', subject: 'Following up on Tuesday', body: '…', draft: true },
      proposal: { confidence: 0.71, agentSlug: 'follow-up-coordinator' },
    });

    expect(d.title).toBe('Draft email to Jane@Example.test — Following up on Tuesday');
    expect(d.record).toEqual({ kind: 'email', key: 'email:jane@example.test', name: 'Jane@Example.test' });
    expect(d.subline).toBe('Email draft › proposed by follow-up-coordinator');
  });

  it('unknown action: rationale first sentence, then the action id spelled out; no record', () => {
    const withRationale = describeActionRun({
      ...base,
      actionId: 'objects.propose_candidate',
      input: {},
      proposal: { rationale: 'Two follow-up events look like the same conference. Merge them.', agentSlug: 'event-debrief-specialist' },
    });

    expect(withRationale.title).toBe('Two follow-up events look like the same conference.');
    expect(withRationale.subline).toBe('Objects propose candidate › proposed by event-debrief-specialist');
    expect(withRationale.record).toBeNull();

    const bare = describeActionRun({ id: 2, actionId: 'qc.flag', input: null, proposal: null, invokedBy: 'token:abc' });

    expect(bare.title).toBe('Qc flag');
    expect(bare.agentSlug).toBeNull();
  });

  it('never throws on a malformed payload', () => {
    const d = describeActionRun({ id: 3, actionId: 'hubspot.update', input: { properties: 'not-an-object' } as never, proposal: 'garbage' as never, invokedBy: null });

    expect(d.title).toBeTruthy();
  });
});

describe('labels', () => {
  it('formats fields, sentences, amounts and confidence for a row', () => {
    expect(humaniseField('hs_next_step')).toBe('Next step');
    expect(humaniseField('custom_field_x')).toBe('Custom field x');
    expect(firstSentence('First thing. Second thing.')).toBe('First thing.');
    expect(amountLabel(12500, 'USD')).toBe('$12,500');
    expect(amountLabel(null, null)).toBe('—');
    expect(confidenceLabel(0.874)).toBe('87%');
    expect(confidenceLabel(null)).toBe('—');
  });
});
