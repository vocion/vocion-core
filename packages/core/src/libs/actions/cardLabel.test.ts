import { describe, expect, it } from 'vitest';
import { buildOrFiling } from '@/services/agents/cardBackstop';
import { labelWithResolvedRefs, ownRecordsOf } from './cardLabel';

// Matrix run s1 (2026-09-29): "(request 207)" on a card, where 207 was an
// environment. A label names a record through the card's own resolved id.

describe('a card names its record by the id its payload resolves', () => {
  it('removes a reference that is not the card\'s own record — a filing has none yet', () => {
    expect(labelWithResolvedRefs('Approve link-expiry feature (request 207) for build', { objectType: 'request', title: 'x' })).toBe('Approve link-expiry feature for build');
    expect(labelWithResolvedRefs('Build request #207 now', {})).toBe('Build request now');
  });

  it('keeps the card\'s own record, and rewrites a wrong number to it', () => {
    expect(labelWithResolvedRefs('Start the build — request #224', { requestId: 224 })).toBe('Start the build — request #224');
    expect(labelWithResolvedRefs('Start the build — request #207', { requestId: 224 })).toBe('Start the build — request #224');
    expect(labelWithResolvedRefs('Approve plan 12 (task #90)', { taskId: 90, planId: 134 })).toBe('Approve plan 134 (task #90)');
  });

  it('leaves a label with no record in it alone', () => {
    expect(labelWithResolvedRefs('Draft the note to Nadia Brandt', { to: 'nadia@example.test' })).toBe('Draft the note to Nadia Brandt');
    expect(labelWithResolvedRefs('Ship 3 fixes', { requestId: 5 })).toBe('Ship 3 fixes');
  });

  it('reads the records a payload is about', () => {
    expect([...ownRecordsOf({ objectType: 'release', id: '12', requestId: 9 })]).toEqual([['release', 12], ['request', 9]]);
  });

  it('the backstop\'s filing title carries no typed record number either', async () => {
    const { call } = await buildOrFiling({ action_id: 'factory.dispatch_task', label: 'Approve link-expiry feature (request 207) for build', action_input: { requestId: 207 } }, async () => false);

    expect((call.action_input as { title: string }).title).toBe('Approve link-expiry feature for build');
    expect(String(call.label)).not.toMatch(/207/);
  });
});
