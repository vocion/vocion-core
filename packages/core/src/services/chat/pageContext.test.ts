import { describe, expect, it } from 'vitest';
import { mergeScopeRef, pageShowsRecord, readContextRefs, readPageContext, readRecordRef, scopeRefToRecord, withPageContext } from './pageContext';

describe('readPageContext', () => {
  it('accepts two short strings and trims them', () => {
    expect(readPageContext({ path: ' /dashboard/review ', title: ' Review ' })).toEqual({ path: '/dashboard/review', title: 'Review' });
  });

  it('reads anything malformed as no context, never as an error', () => {
    expect(readPageContext(undefined)).toBeNull();
    expect(readPageContext('x')).toBeNull();
    expect(readPageContext({ path: 42, title: 'Review' })).toBeNull();
    expect(readPageContext({ path: '   ', title: 'Review' })).toBeNull();
  });

  it('caps oversized values instead of rejecting them', () => {
    const ctx = readPageContext({ path: `/${'a'.repeat(500)}`, title: 'b'.repeat(500) });

    expect(ctx?.path).toHaveLength(200);
    expect(ctx?.title).toHaveLength(200);
  });

  it('keeps a well-formed record, selection, refs and openedFrom', () => {
    const ctx = readPageContext({
      path: '/dashboard/briefings',
      title: 'Briefings',
      record: { type: 'briefing', id: '61', label: 'Revenue Briefing — Mon', href: '/dashboard/briefings' },
      selection: { text: 'StreetTalk — $110K, close Sep 19' },
      refs: [{ type: 'deal', id: 'deals:611' }, { type: 'nope', id: 'x' }],
      openedFrom: true,
    });

    expect(ctx?.record).toEqual({ type: 'briefing', id: '61', label: 'Revenue Briefing — Mon', href: '/dashboard/briefings' });
    expect(ctx?.selection).toEqual({ text: 'StreetTalk — $110K, close Sep 19', quote: true });
    expect(ctx?.refs).toEqual([{ type: 'deal', id: 'deals:611' }]);
    expect(ctx?.openedFrom).toBe(true);
  });

  it('drops a malformed record without dropping the page', () => {
    const ctx = readPageContext({ path: '/dashboard/inbox', title: 'Review queue', record: { type: 'ask' } });

    expect(ctx).toEqual({ path: '/dashboard/inbox', title: 'Review queue' });
  });

  it('only lets in-app relative hrefs through on a ref', () => {
    expect(readRecordRef({ type: 'ask', id: '7', href: 'https://evil.example/x' })?.href).toBeUndefined();
    expect(readRecordRef({ type: 'ask', id: '7', href: '//evil.example/x' })?.href).toBeUndefined();
    expect(readRecordRef({ type: 'ask', id: '7', href: '/dashboard/inbox/7' })?.href).toBe('/dashboard/inbox/7');
  });

  it('ignores an empty title but requires a path', () => {
    expect(readPageContext({ path: '/dashboard/review' })).toEqual({ path: '/dashboard/review', title: '' });
  });
});

describe('mergeScopeRef', () => {
  it('folds a scoped dock ref into the context instead of excluding it', () => {
    const merged = mergeScopeRef({ path: '/gtm/lead/9412', title: 'Nadia' }, 'contacts:9412');

    expect(merged?.refs).toEqual([{ type: 'object', id: 'contacts:9412' }]);
  });

  it('maps deals onto the deal record type and never duplicates', () => {
    expect(scopeRefToRecord('deals:611')).toEqual({ type: 'deal', id: 'deals:611' });

    const once = mergeScopeRef({ path: '/x', title: '', refs: [{ type: 'deal', id: 'deals:611' }] }, 'deals:611');

    expect(once?.refs).toHaveLength(1);
  });

  it('builds a context from a bare scope when the page sent none', () => {
    expect(mergeScopeRef(null, 'contacts:1')).toEqual({ path: '', title: '', refs: [{ type: 'object', id: 'contacts:1' }] });
    expect(mergeScopeRef(null, null)).toBeNull();
  });
});

describe('withPageContext', () => {
  it('leaves a context-free message alone', () => {
    expect(withPageContext('what is waiting?', null)).toBe('what is waiting?');
  });

  it('adds where the person is, under the message, for the model only', () => {
    const out = withPageContext('what is waiting?', { path: '/dashboard/review', title: 'Review' });

    expect(out.startsWith('what is waiting?\n\n--- where I am ---')).toBe(true);
    expect(out).toContain('"Review" (/dashboard/review)');
    expect(out).toContain('about what that page shows');
  });

  it('falls back to the path when the title is empty', () => {
    expect(withPageContext('hi', { path: '/dashboard/review', title: '' })).toContain('looking at /dashboard/review in the app');
  });

  it('names the record, the mentions and quotes the selection', () => {
    const out = withPageContext('kill it', {
      path: '/dashboard/briefings',
      title: 'Briefings',
      record: { type: 'briefing', id: '61', label: 'Revenue Briefing — Mon', href: '/dashboard/briefings' },
      refs: [{ type: 'deal', id: 'deals:611', label: 'Northwind' }],
      selection: { text: 'Northwind – $216K\nstalling', quote: true },
    });

    expect(out).toContain('This page is about the briefing "Revenue Briefing — Mon" (/dashboard/briefings).');
    expect(out).toContain('I mentioned: deal "Northwind".');
    expect(out).toContain('> Northwind – $216K\n> stalling');
    // The prose deliberately does NOT name the tool: handing a model the
    // details and then pointing at a tool that returns the same details is
    // what produced a turn that announced a lookup instead of answering.
    expect(out).not.toContain('`page_context` tool');
    expect(out).toContain('answer from it');
  });
});

describe('readContextRefs', () => {
  it('keeps well-formed tags, drops malformed ones, and caps the list', () => {
    const raw = [
      { type: 'team', id: 'revenue-ops', label: 'RevOps', routeTo: 'revenue-lead' },
      { type: 'mission', id: '  q3-pipeline ', label: 'Q3 pipeline' },
      { type: 'deal', id: '', label: 'nothing' },
      'not a ref',
      null,
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'object', id: String(i), label: `o${i}` })),
    ];

    const refs = readContextRefs(raw);

    expect(refs[0]).toEqual({ type: 'team', id: 'revenue-ops', label: 'RevOps' });
    expect(refs[1]).toEqual({ type: 'mission', id: 'q3-pipeline', label: 'Q3 pipeline' });
    expect(refs).toHaveLength(12);
  });

  it('reads anything that is not an array as no tags', () => {
    expect(readContextRefs(undefined)).toEqual([]);
    expect(readContextRefs({ type: 'team' })).toEqual([]);
  });
});

describe('withPageContext with tagged records', () => {
  it('lists the tagged records under the message so an @tag reaches the model, not only the router', () => {
    const out = withPageContext('what is blocking?', null, [{ type: 'team', id: 'revenue-ops', label: 'RevOps' }]);

    expect(out.startsWith('what is blocking?')).toBe(true);
    expect(out).toContain('--- records I tagged ---');
    expect(out).toContain('- team "RevOps" (team:revenue-ops)');
  });

  it('stacks the page note and the tags note in that order', () => {
    const out = withPageContext('hi', { path: '/dashboard/review', title: 'Review' }, [{ type: 'deal', id: '9', label: '' }]);

    expect(out.indexOf('--- where I am ---')).toBeLessThan(out.indexOf('--- records I tagged ---'));
    expect(out).toContain('- deal "9" (deal:9)');
  });
});

describe('pageShowsRecord — is the record already on screen?', () => {
  const LEAD = { path: '/gtm/lead/9412', title: 'A lead', record: { type: 'object' as const, id: 'contacts:9412', label: 'A lead' } };

  it('is true when the page beside the rail IS that record\'s page', () => {
    expect(pageShowsRecord(LEAD, scopeRefToRecord('contacts:9412'))).toBe(true);
  });

  it('is false for a different record of the same type — the rail must not go quiet beside the wrong page', () => {
    expect(pageShowsRecord(LEAD, scopeRefToRecord('contacts:9999'))).toBe(false);
  });

  it('is false for the same id under a different type', () => {
    expect(pageShowsRecord(LEAD, { type: 'deal', id: 'contacts:9412' })).toBe(false);
  });

  it('is false where there is no page beside the rail — the full-page chat, which is why the guided review survives there', () => {
    expect(pageShowsRecord(null, scopeRefToRecord('contacts:9412'))).toBe(false);
    expect(pageShowsRecord(undefined, scopeRefToRecord('contacts:9412'))).toBe(false);
    expect(pageShowsRecord({ path: '/dashboard/chat', title: 'Chat' }, scopeRefToRecord('contacts:9412'))).toBe(false);
  });

  it('is false when the rail is about nothing in particular', () => {
    expect(pageShowsRecord(LEAD, null)).toBe(false);
    expect(pageShowsRecord(LEAD, undefined)).toBe(false);
  });

  it('ignores label and href — two refs at the same record are the same record', () => {
    expect(pageShowsRecord(LEAD, { type: 'object', id: 'contacts:9412', label: 'Renamed', href: '/elsewhere' })).toBe(true);
  });
});
