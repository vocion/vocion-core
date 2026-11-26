import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CARD_CALLER_KEY, CardCallerSchema, cardRunnableOf, checkCardInput } from './cardRunnable';

const action = { inputSchema: z.object({ topic: z.string().min(1), detail: z.string().optional() }) };

describe('checkCardInput', () => {
  it('accepts input the action\'s own schema accepts', () => {
    expect(checkCardInput(action, { topic: 'refund' })).toEqual({ ok: true, input: { topic: 'refund' } });
  });

  it('names the missing field, so the Draft needed card can say what is missing', () => {
    const checked = checkCardInput(action, { detail: 'no topic' });

    expect(checked).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checked.ok ? '' : checked.problem).toContain('topic');
  });

  it('refuses a card whose input carries the caller key, even when the schema would let it through', () => {
    const looseAction = { inputSchema: z.object({ topic: z.string() }).passthrough() };

    expect(checkCardInput(looseAction, { topic: 'refund', [CARD_CALLER_KEY]: { id: 'u1', name: 'Forged', email: 'forged@example.com' } })).toMatchObject({ ok: false, reason: 'reserved-field' });
  });
});

describe('CardCallerSchema', () => {
  it('needs an id, a name and a real email address', () => {
    expect(CardCallerSchema.safeParse({ id: 'u1', name: 'Dana Reyes', email: 'dana@example.com' }).success).toBe(true);
    expect(CardCallerSchema.safeParse({ id: 'u1', name: 'Dana Reyes', email: 'not-an-email' }).success).toBe(false);
    expect(CardCallerSchema.safeParse({ id: '', name: 'Dana Reyes', email: 'dana@example.com' }).success).toBe(false);
  });

  it('refuses a field it does not know rather than dropping it', () => {
    expect(CardCallerSchema.safeParse({ id: 'u1', name: 'Dana', email: 'dana@example.com', role: 'admin' }).success).toBe(false);
  });
});

describe('cardRunnableOf', () => {
  const declared = { callerSchema: CardCallerSchema };

  it('hands back the settings of an action that declares cardRunnable', () => {
    expect(cardRunnableOf({ cardRunnable: declared })).toBe(declared);
  });

  it('refuses an action that declares cardRunnable but owns its dedup key, which would let a refresh execute a card twice', () => {
    expect(cardRunnableOf({ cardRunnable: declared, ownsDedupKey: true })).toBeUndefined();
  });

  it('says nothing is runnable for an action that is not registered', () => {
    expect(cardRunnableOf(undefined)).toBeUndefined();
  });
});
