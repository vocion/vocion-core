/**
 * No duplicate asks: the open ask of an agent's that a new one would ask
 * again (`duplicateOpenAsk`). Pure.
 */
import { describe, expect, it } from 'vitest';

const { duplicateOpenAsk } = await import('./fileAsk');

const plan = { id: 371, title: 'Sign off the keyword plan: Northwind trail shoes', kind: 'signoff', groupKey: 'seo-batch:12', objectRefs: [{ type: 'object', id: '12' }], conversationId: null };

describe('duplicateOpenAsk', () => {
  it('the same records and the same kind family is the same question, however it is worded', () => {
    expect(duplicateOpenAsk({ kind: 'approval', objectRefs: [{ type: 'object', id: 12 }] }, [plan])).toBe(plan);
  });

  it('the same records under the same group key is the same question, even of another kind', () => {
    expect(duplicateOpenAsk({ kind: 'input', groupKey: 'seo-batch:12', objectRefs: [{ type: 'object', id: '12' }] }, [plan])).toBe(plan);
    expect(duplicateOpenAsk({ kind: 'input', objectRefs: [{ type: 'object', id: '12' }] }, [plan])).toBeNull();
  });

  it('other records, or more of them, are a different question', () => {
    expect(duplicateOpenAsk({ kind: 'approval', objectRefs: [{ type: 'object', id: '13' }] }, [plan])).toBeNull();
    expect(duplicateOpenAsk({ kind: 'approval', objectRefs: [{ type: 'object', id: '12' }, { type: 'object', id: '13' }] }, [plan])).toBeNull();
  });

  it('a group key alone is a decision sheet, not a duplicate', () => {
    const sheetRow = { ...plan, objectRefs: [] };

    expect(duplicateOpenAsk({ kind: 'approval', groupKey: 'seo-batch:12' }, [sheetRow])).toBeNull();
  });

  it('in this conversation, an unanchored go-ahead beside one already docked here is the same ask', () => {
    const docked = { ...plan, conversationId: 501 };

    expect(duplicateOpenAsk({ kind: 'approval', conversationId: 501 }, [docked])).toBe(docked);
    expect(duplicateOpenAsk({ kind: 'approval', conversationId: 502 }, [docked])).toBeNull();
    expect(duplicateOpenAsk({ kind: 'input', conversationId: 501 }, [docked])).toBeNull();
    expect(duplicateOpenAsk({ kind: 'approval', conversationId: 501, objectRefs: [{ type: 'request', id: '9' }] }, [docked])).toBeNull();
  });
});
