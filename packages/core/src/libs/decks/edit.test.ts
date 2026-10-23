import type { DeckSpec } from '@/libs/cards/specs';
import { describe, expect, it } from 'vitest';
import { applyDeckOps, DeckEditError, deckProblems } from './edit';

const s = (id: string, body: string, notes = 'Source: Northwind discovery call, 2026-09-12.') => `<section id="${id}" style="padding:120px">${body}<aside>${notes}</aside></section>`;

function deck(): DeckSpec {
  return {
    format: 'vocion-deck/1',
    title: 'Northwind — one record',
    order: ['cover', 'problem', 'ask'],
    slides: {
      cover: s('cover', '<h1>Northwind runs on one record</h1>'),
      problem: s('problem', '<h2>Today</h2><p>Orders live in four places.</p>'),
      ask: s('ask', '<h2>The ask</h2><p>Start on [date].</p>'),
    },
    sections: { open: { description: 'Opening', start: 'cover' }, close: { description: 'Close', start: 'ask' } },
  };
}

describe('applyDeckOps', () => {
  it('replaces, inserts, moves and retitles in one batch', () => {
    const r = applyDeckOps(deck(), [
      { op: 'replace_slide', id: 'problem', html: s('problem', '<h2>Today</h2><p>Orders live in three places.</p>') },
      { op: 'insert_slide', after: 'problem', html: s('plan', '<h2>The plan</h2>') },
      { op: 'insert_slide', after: '^', html: s('title', '<h1>Title</h1>') },
      { op: 'move_slide', id: 'ask', to: 2 },
      { op: 'set_title', title: 'Northwind — v2' },
    ]);

    expect(r.spec.order).toEqual(['title', 'ask', 'cover', 'problem', 'plan']);
    expect(r.spec.title).toBe('Northwind — v2');
    expect(r.spec.slides.problem).toContain('three places');
    expect(r.touched.sort()).toEqual(['plan', 'problem', 'title']);
    expect(r.applied).toHaveLength(5);
  });

  it('replace_text must match exactly once — in the named slide, or across the deck', () => {
    expect(applyDeckOps(deck(), [{ op: 'replace_text', find: 'four places', replace: 'three places' }]).spec.slides.problem).toContain('three places');
    expect(() => applyDeckOps(deck(), [{ op: 'replace_text', find: 'Northwind discovery', replace: 'x' }])).toThrow(/matched "Northwind discovery" 3 times .*cover×1, problem×1, ask×1/);
    expect(applyDeckOps(deck(), [{ op: 'replace_text', find: 'Northwind discovery', replace: 'Kestrel', slide: 'ask' }]).spec.slides.ask).toContain('Source: Kestrel call');
    expect(applyDeckOps(deck(), [{ op: 'replace_text', find: 'Northwind discovery', replace: 'Kestrel', all: true }]).touched).toHaveLength(3);
    expect(() => applyDeckOps(deck(), [{ op: 'replace_text', find: 'nowhere', replace: 'x' }])).toThrow(/found no "nowhere"/);
  });

  it('sets and clears notes as plain text', () => {
    const set = applyDeckOps(deck(), [{ op: 'set_notes', id: 'cover', notes: 'Kestrel Capital asked for this framing.' }]);

    expect(set.spec.slides.cover).toContain('<aside>Kestrel Capital asked for this framing.</aside>');
    expect(applyDeckOps(set.spec, [{ op: 'set_notes', id: 'cover', notes: '' }]).spec.slides.cover).not.toContain('<aside>');
  });

  it('removes a slide and the section that started on it', () => {
    const r = applyDeckOps(deck(), [{ op: 'remove_slide', id: 'ask' }]);

    expect(r.spec.order).toEqual(['cover', 'problem']);
    expect(r.spec.slides.ask).toBeUndefined();
    expect(Object.keys(r.spec.sections ?? {})).toEqual(['open']);
  });

  it('sets and removes assets', () => {
    const r = applyDeckOps(deck(), [{ op: 'set_asset', asset: 'logo', value: { url: '/api/artifacts/org-abc/org-abc.png', contentType: 'image/png' } }]);

    expect(r.spec.assets?.logo?.contentType).toBe('image/png');
    expect(applyDeckOps(r.spec, [{ op: 'set_asset', asset: 'logo', value: null }]).spec.assets).toEqual({});
  });

  it('is all or none: a bad op anywhere changes nothing and says why', () => {
    const before = deck();
    const run = () => applyDeckOps(before, [
      { op: 'set_title', title: 'Changed' },
      { op: 'remove_slide', id: 'nope' },
    ]);

    expect(run).toThrow(DeckEditError);
    expect(run).toThrow(/no slide "nope"/);
    expect(before.title).toBe('Northwind — one record');
    expect(() => applyDeckOps(before, [{ op: 'replace_slide', id: 'cover', html: s('renamed', '<h1>x</h1>') }])).toThrow(/keep the id/);
    expect(() => applyDeckOps(before, [{ op: 'insert_slide', html: s('cover', '<h1>x</h1>') }])).toThrow(/already exists/);
    expect(() => applyDeckOps(before, [{ op: 'replace_slide', id: 'cover', html: '<section id="cover"><script>x()</script></section>' }])).toThrow(/would leave the deck invalid/);
  });
});

describe('deckProblems', () => {
  it('names an order entry with no slide, a slide not in the order, and a bad section start', () => {
    const bad = { ...deck(), order: ['cover', 'ghost'], sections: { x: { description: 'x', start: 'ask' } } };

    expect(deckProblems(bad).join('\n')).toMatch(/"ghost" is in the order but has no HTML/);
    expect(deckProblems(bad).join('\n')).toMatch(/"problem" has HTML but is not in the order/);
    expect(deckProblems(deck())).toEqual([]);
  });
});
