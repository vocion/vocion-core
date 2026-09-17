import { describe, expect, it } from 'vitest';
import { changeSummaryLine, summariseChanges } from './changeSummary';

const update = (properties: Record<string, unknown>) => ({ actionId: 'hubspot.update', input: { objectType: 'deals', objectId: '900112', properties } });
const many = (n: number, properties: Record<string, unknown>) => Array.from({ length: n }, () => update(properties));

describe('summariseChanges', () => {
  it('names the one kind when a record is all of a piece', () => {
    const buckets = summariseChanges(many(17, { description: 'x' }));

    expect(buckets).toEqual([{ label: 'field update', system: 'CRM', count: 17 }]);
    expect(changeSummaryLine(buckets)).toBe('17 CRM field updates');
  });

  it('bucket by bucket, biggest first, when a record is a mix', () => {
    const buckets = summariseChanges([
      ...many(12, { description: 'x' }),
      ...many(3, { hs_next_step: 'Send the terms' }),
      ...many(2, { closedate: '2026-11-30' }),
    ]);

    expect(changeSummaryLine(buckets)).toBe('12 field updates · 3 next steps · 2 close-date changes');
  });

  it('a CRM update that mixes kinds is a field update, because no one name is true of it', () => {
    expect(summariseChanges([update({ closedate: '2026-11-30', dealstage: 'contractsent' })])[0]?.label).toBe('field update');
    // A field that only names the record does not make a bucket of its own.
    expect(summariseChanges([update({ dealname: 'Northwind renewal', closedate: '2026-11-30' })])[0]?.label).toBe('close-date change');
  });

  it('reads enrollments, emails, drafts and anything else it does not know', () => {
    const buckets = summariseChanges([
      { actionId: 'personalization.enroll', input: {} },
      { actionId: 'gmail.send', input: { draft: true } },
      { actionId: 'gmail.send', input: {} },
      { actionId: 'objects.propose_candidate', input: {} },
    ]);

    expect(buckets.map(b => b.label).sort()).toEqual(['email', 'email draft', 'enrollment', 'objects propose candidate']);
  });

  it('shows the top three and totals the tail, and is stable at equal counts', () => {
    const line = changeSummaryLine(summariseChanges([
      ...many(2, { closedate: '2026-11-30' }),
      ...many(2, { dealstage: 'contractsent' }),
      ...many(2, { amount: '1' }),
      ...many(1, { hubspot_owner_id: '9' }),
      ...many(1, { hs_next_step: 'x' }),
    ]));

    expect(line).toBe('2 amount changes · 2 close-date changes · 2 stage changes · +2 more');
  });

  it('says nothing about nothing', () => {
    expect(changeSummaryLine(summariseChanges([]))).toBe('');
  });
});
