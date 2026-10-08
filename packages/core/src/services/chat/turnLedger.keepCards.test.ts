import type { ConversationRun } from '@/services/ConversationService';
import { describe, expect, it } from 'vitest';
import { keepCardDecisions } from './turnLedger';

/**
 * A card pressed while its turn is still being written down keeps what it
 * became when the turn's own copy of its runs lands over the row.
 */

const proposed: ConversationRun = { type: 'card', id: 'card_a', kind: 'setup', label: 'Add Software Factory', actionId: 'app.install', input: { app: 'software-factory' }, state: 'proposed' };
const text: ConversationRun = { type: 'text', text: 'Here is the plan.' };

describe('keepCardDecisions', () => {
  it('carries a decided card\'s run, state and decision onto the turn\'s copy', () => {
    const stored: ConversationRun[] = [{ ...proposed, runId: 41, state: 'decided', decision: { action: 'approve', at: '2026-10-08T17:45:00.000Z', by: 'usr-dana' } } as ConversationRun];
    const out = keepCardDecisions([text, proposed], stored);

    expect(out?.[0]).toEqual(text);
    expect(out?.[1]).toMatchObject({ id: 'card_a', runId: 41, state: 'decided', decision: { action: 'approve' } });
  });

  it('leaves everything else as the turn wrote it', () => {
    expect(keepCardDecisions([text, proposed], [proposed])).toEqual([text, proposed]);
    expect(keepCardDecisions([text], null)).toEqual([text]);
    expect(keepCardDecisions(null, [proposed])).toBeNull();
  });

  it('does not undo what the turn itself knows newer', () => {
    const filed = { ...proposed, runId: 50, state: 'filed' } as ConversationRun;
    const stored = [{ ...proposed, runId: 41, state: 'decided' } as ConversationRun];

    expect(keepCardDecisions([filed], stored)).toEqual([filed]);
  });
});
