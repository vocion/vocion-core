import { describe, expect, it } from 'vitest';
import { openAsksTurnNote, revisionTarget } from './revise';

/**
 * Which waiting ask a recommendation revises, read off typed fields — the
 * agent's own link, else the same action on the same record in the same
 * conversation — never off its words. Fixtures are fictional (Northwind).
 * @param input
 */
const ref = (input: Record<string, unknown>) => (typeof input.objectType === 'string' && Number(input.id) > 0 ? { objectType: input.objectType, id: Number(input.id) } : null);
const ask = (id: number, actionId: string, input: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ id, kind: 'approval', conversationId: 9, title: `Ask ${id}`, options: [{ id: 'approve', label: 'Allow once', action: { id: actionId, input } }], ...over });

describe('revisionTarget', () => {
  it('takes the agent\'s link when it names an approval waiting here, and nothing else', () => {
    const open = [ask(3, 'gmail.send', {}), ask(4, 'gmail.send', {}, { conversationId: 8 })];

    expect(revisionTarget({ actionId: 'gmail.send', input: {}, supersedes: 3 }, open, 9, ref)).toBe(3);
    expect(revisionTarget({ actionId: 'gmail.send', input: {}, supersedes: 4 }, open, 9, ref)).toBeNull();
  });

  it('else the newest approval running the same action on the same record', () => {
    const open = [ask(5, 'hubspot.update', { objectType: 'deal', id: 4410 }), ask(6, 'hubspot.update', { objectType: 'deal', id: 4410 }), ask(7, 'hubspot.update', { objectType: 'deal', id: 52 })];

    expect(revisionTarget({ actionId: 'hubspot.update', input: { objectType: 'deal', id: '4410' } }, open, 9, ref)).toBe(6);
    expect(revisionTarget({ actionId: 'gmail.send', input: { objectType: 'deal', id: 4410 } }, open, 9, ref)).toBeNull();
    // No record named and no link: a separate action, never a guess.
    expect(revisionTarget({ actionId: 'gmail.send', input: { to: 'pat@northwind.example' } }, [ask(8, 'gmail.send', { to: 'pat@northwind.example' })], 9, ref)).toBeNull();
  });
});

describe('openAsksTurnNote', () => {
  it('lists the approvals waiting here by number, and says none of them has happened yet', () => {
    const note = openAsksTurnNote([ask(503, 'gmail.send', {}, { title: 'Draft the Northwind intro ask' }), { ...ask(9, 'x', {}), kind: 'ruling' }]);

    expect(note).toContain('- #503 (gmail.send): Draft the Northwind intro ask');
    expect(note).toContain('nothing in them has happened yet');
    expect(note).not.toContain('#9');
    expect(openAsksTurnNote([])).toBe('');
  });
});
