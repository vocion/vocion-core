import { describe, expect, it } from 'vitest';
import { amountLabel, confidenceLabel, describeActionRun, firstSentence, humaniseField } from './describeActionRun';

const base = { id: 1, invokedBy: 'agent:revenue-lead' as string | null };

describe('describeActionRun', () => {
  it('hubspot.update on a deal: names the deal, lists the changes with old → new when known, reads the amount', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'hubspot.update',
      input: { objectType: 'deals', objectId: '7781', properties: { dealname: 'Spinutech — AI workforce', dealstage: 'contractsent', hs_next_step: 'Send MSA', amount: '48000' } },
      proposal: { confidence: 0.82, rationale: 'The MSA went out on the 12th; the stage still says proposal.', agentSlug: 'deal-desk', before: { dealstage: 'presentationscheduled' } },
    });

    expect(d.title).toBe('Update Spinutech — AI workforce — Deal stage: presentationscheduled → contractsent, Next step: Send MSA, Amount: $48,000');
    expect(d.subline).toBe('Spinutech — AI workforce › CRM update › proposed by deal-desk');
    expect(d.record).toEqual({ kind: 'deal', key: 'hubspot:deals:7781', name: 'Spinutech — AI workforce' });
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
    expect(d.agentSlug).toBe('revenue-lead');
    expect(d.amount).toBeNull();
  });

  it('personalization.enroll: contact, company and sequence; keyed on the contact ref', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'personalization.enroll',
      input: { leadBriefId: 3, contactRef: 'contacts:88201', contactName: 'Jamie Smith', companyName: 'Redpoint IT', sequenceId: 's1', sequenceName: 'MSP triage nurture', senderEmail: 'c@metacto.com', sends: [] },
      proposal: { confidence: 0.88, agentSlug: 'personalization' },
    });

    expect(d.title).toBe('Enroll Jamie Smith (Redpoint IT) in MSP triage nurture');
    expect(d.subline).toBe('Jamie Smith (Redpoint IT) › Enrollment › proposed by personalization');
    expect(d.record).toEqual({ kind: 'contact', key: 'hubspot:contacts:88201', name: 'Jamie Smith (Redpoint IT)' });
    expect(d.actionKind).toBe('Enrollment');
  });

  it('gmail.send: recipient and subject; a draft says so; keyed on the address, case-folded', () => {
    const d = describeActionRun({
      ...base,
      actionId: 'gmail.send',
      input: { to: 'Jane@Acme.com', subject: 'Following up on Tuesday', body: '…', draft: true },
      proposal: { confidence: 0.71, agentSlug: 'follow-up-coordinator' },
    });

    expect(d.title).toBe('Draft email to Jane@Acme.com — Following up on Tuesday');
    expect(d.record).toEqual({ kind: 'email', key: 'email:jane@acme.com', name: 'Jane@Acme.com' });
    expect(d.subline).toBe('Jane@Acme.com › Email draft › proposed by follow-up-coordinator');
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
