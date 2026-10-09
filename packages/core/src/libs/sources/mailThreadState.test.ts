import type { ThreadMessage } from './mailThreadState';
import { describe, expect, it } from 'vitest';
import { facetsMatch, validateFacetFilter } from '@/libs/retrieval/facets';
import { fallbackLabel, parseLabel, priorFromMetadata, reuse, ruleLabel, threadFacts, threadStateDoc } from './mailThreadState';

const OWNER = 'owner@metacto.example';
const msg = (over: Partial<ThreadMessage> & Pick<ThreadMessage, 'id' | 'from'>): ThreadMessage => ({
  to: OWNER,
  date: new Date('2026-10-01T10:00:00Z'),
  subject: 'Pricing',
  snippet: 'Could you send pricing?',
  bulk: false,
  ...over,
});

describe('thread facts', () => {
  it('reads who wrote last and when each side last wrote, whatever order the messages come in', () => {
    const f = threadFacts('t1', [
      msg({ id: 'b', from: 'Jamie Smith <jamie@contoso.example>', date: new Date('2026-10-03T10:00:00Z') }),
      msg({ id: 'a', from: `Owner <${OWNER}>`, to: 'jamie@contoso.example', date: new Date('2026-10-02T10:00:00Z') }),
    ], 'Owner@Metacto.example')!;

    expect(f).toMatchObject({ lastDirection: 'inbound', lastMessageId: 'b', counterpart: 'Jamie Smith <jamie@contoso.example>', messageCount: 2 });
    expect(f.lastOutboundAt?.toISOString()).toBe('2026-10-02T10:00:00.000Z');
  });

  it('the owner writing last settles it as waiting, and bulk mail as fyi, with no model', () => {
    const waiting = threadFacts('t2', [msg({ id: 'a', from: 'jamie@contoso.example' }), msg({ id: 'b', from: OWNER, date: new Date('2026-10-02T00:00:00Z') })], OWNER)!;

    expect(ruleLabel(waiting)?.state).toBe('waiting_on_them');

    const bulk = threadFacts('t3', [msg({ id: 'a', from: 'news@cobalt.example', bulk: true })], OWNER)!;

    expect(ruleLabel(bulk)?.state).toBe('fyi');

    const open = threadFacts('t4', [msg({ id: 'a', from: 'jamie@contoso.example' })], OWNER)!;

    expect(ruleLabel(open)).toBeNull();
    // Without a model an unanswered thread is owed: over-reporting is recoverable, missing one is not.
    expect(fallbackLabel(open)).toMatchObject({ state: 'needs_my_reply', labelledBy: 'rule' });
  });
});

describe('labels', () => {
  it('parses a classifier answer and refuses one that is not a label', () => {
    expect(parseLabel('Here: {"state":"needs_my_reply","category":"sales","ask":"Wants   pricing"}', 'claude-haiku-4-5')).toEqual({ state: 'needs_my_reply', category: 'sales', ask: 'Wants pricing', labelledBy: 'claude-haiku-4-5' });
    expect(parseLabel('{"state":"waiting_on_them"}', 'm')).toBeNull();
    expect(parseLabel('no json', 'm')).toBeNull();
  });

  it('keeps a model label while the last message is the same, and retries a rule label', () => {
    const f = threadFacts('t5', [msg({ id: 'm1', from: 'jamie@contoso.example' })], OWNER)!;
    const doc = threadStateDoc(f, { state: 'needs_my_reply', category: 'sales', ask: 'Pricing', labelledBy: 'claude-haiku-4-5' }, { connector: 'gmail' });
    const prior = priorFromMetadata(doc.metadata);

    expect(reuse(prior, f)?.ask).toBe('Pricing');

    const grown = threadFacts('t5', [msg({ id: 'm1', from: 'jamie@contoso.example' }), msg({ id: 'm2', from: 'jamie@contoso.example', date: new Date('2026-10-05T00:00:00Z') })], OWNER)!;

    expect(reuse(prior, grown)).toBeNull();

    const ruled = priorFromMetadata(threadStateDoc(f, fallbackLabel(f), { connector: 'gmail' }).metadata);

    expect(reuse(ruled, f)).toBeNull();
  });

  it('files facets a filter can match', () => {
    const f = threadFacts('t6', [msg({ id: 'm1', from: 'Jamie Smith <jamie@contoso.example>', date: new Date('2026-10-04T00:00:00Z') })], OWNER)!;
    const doc = threadStateDoc(f, { state: 'needs_my_reply', category: 'sales', ask: 'Pricing', labelledBy: 'm' }, { connector: 'gmail' });
    const facets = (doc.metadata as { facets: Record<string, string> }).facets;

    expect(doc.externalId).toBe('gmail-thread-state:t6');
    expect(facetsMatch(facets, { reply_state: 'needs_my_reply', category: ['sales', 'customer'], counterpart: 'CONTOSO', last_inbound_at: { since: '2026-10-01T00:00:00Z' } })).toBe(true);
    expect(facetsMatch(facets, { last_inbound_at: { since: '2026-10-05T00:00:00Z' } })).toBe(false);
    expect(facetsMatch(facets, { category: 'vendor' })).toBe(false);
  });
});

describe('facet filters', () => {
  it('names the allowed values when a filter is wrong, so one step corrects it', () => {
    expect(validateFacetFilter({ reply_state: 'unanswered' })[0]?.message).toContain('needs_my_reply');
    expect(validateFacetFilter({ mood: 'x' })[0]?.message).toContain('unknown facet');
    expect(validateFacetFilter({ last_inbound_at: 'yesterday' })[0]?.message).toContain('since');
    expect(validateFacetFilter({ reply_state: ['needs_my_reply', 'fyi'], category: 'sales' })).toEqual([]);
  });
});
