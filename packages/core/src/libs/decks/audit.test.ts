import type { DeckSpec } from '@/libs/cards/specs';
import { describe, expect, it } from 'vitest';
import { deckVerificationChip, deckVerificationReceipt, evaluateDeck, mergeSlideFacts, staticSlideFacts } from './audit';

const deck: DeckSpec = {
  format: 'vocion-deck/1',
  title: 'Kestrel Capital — case study',
  order: ['one', 'two'],
  slides: {
    one: '<section id="one"><h1>Bellwater Hall, before</h1><img src="asset:logo"><img src="asset:missing"><img src="https://cdn.example/x.png"><aside>From the 2026-09-12 call.</aside></section>',
    two: '<section id="two"><h2>Saved [$__k] by [date]</h2><x-icon name="Unicorn"></x-icon></section>',
  },
  assets: { logo: { url: '/api/artifacts/org-x/org-x.png', contentType: 'image/png' } },
};

describe('the deck audit', () => {
  it('reads placeholders, notes and asset references off the markup', () => {
    const [one, two] = staticSlideFacts(deck);

    expect(one).toMatchObject({ n: 1, label: 'Bellwater Hall, before', hasNotes: true, placeholders: [] });
    expect(one!.unresolvedAssets).toEqual(['asset:missing (no such asset)', 'https://cdn.example/x.png (not a Vocion asset)']);
    expect(two).toMatchObject({ hasNotes: false, placeholders: ['[$__k]', '[date]'], unknownElements: ['icon:Unicorn'] });
  });

  it('blocks on geometry, small text, unknowns and assets; reports the rest', () => {
    const facts = staticSlideFacts(deck);
    const v = evaluateDeck({
      slides: [
        mergeSlideFacts(facts[0]!, { id: 'one', n: 1, overflowPx: 40, clipped: ['p "Long" (+40px)'], smallText: ['p "fine print" (16px)'], belowFooter: ['p "late" (to y 990)'], elementCount: 5, unknownElements: [], brokenImages: [] }, '/api/artifacts/org-x/s1.png'),
        mergeSlideFacts(facts[1]!),
      ],
      pdfPages: 2,
    });

    expect(v.ok).toBe(false);
    expect(v.issues.join('\n')).toMatch(/Slide 1 \(Bellwater Hall, before\): p "Long" \(\+40px\) runs past the 1920×1080 canvas/);
    expect(v.issues.join('\n')).toMatch(/text under 24px/);
    expect(v.issues.join('\n')).toMatch(/cannot draw icon:Unicorn/);
    expect(v.issues.join('\n')).toMatch(/asset:missing/);
    expect(v.reports.join('\n')).toMatch(/below the footer line/);
    expect(v.reports.join('\n')).toMatch(/placeholders still open — \[\$__k\], \[date\]/);
    expect(v.reports.join('\n')).toMatch(/Slide 2 \(Saved \[\$__k\] by \[date\]\) has no speaker notes/);
    expect(v.slides[0]!.image).toBe('/api/artifacts/org-x/s1.png');
    expect(deckVerificationReceipt(v, { images: true })).toContain('slide 1 [one]');
    expect(deckVerificationChip(v, 2)).toMatch(/^2 slides · \d+ issues$/);
  });

  it('a clean deck with only reports is ok, and a page count off by one is not', () => {
    const clean = { id: 'a', n: 1, overflowPx: 0, clipped: [], smallText: [], belowFooter: ['x'], elementCount: 3, unknownElements: [], unresolvedAssets: [], placeholders: ['[date]'], hasNotes: false };

    expect(evaluateDeck({ slides: [clean], pdfPages: 1 }).ok).toBe(true);
    expect(evaluateDeck({ slides: [clean], pdfPages: 2 }).issues[0]).toMatch(/2 pages for 1 slides/);
    expect(evaluateDeck({ slides: [{ ...clean, elementCount: 201 }], pdfPages: null }).issues[0]).toMatch(/201 elements/);
    expect(deckVerificationChip(undefined, 3)).toBe('3 slides · not verified');
  });

  it('a long element description shortens the finding, never rejects the write', () => {
    const long = `p "${'Every lead reaches a ninety percent estimate while the client is still deciding. '.repeat(8)}" (+12px)`;
    const v = evaluateDeck({
      slides: [{ id: 'a', n: 1, label: 'x'.repeat(200), overflowPx: 12, clipped: [long, long, long], smallText: [long], belowFooter: [long], elementCount: 3, unknownElements: [], unresolvedAssets: [], placeholders: [], hasNotes: true }],
      pdfPages: 1,
    });

    expect([...v.issues, ...v.reports].every(line => line.length <= 300)).toBe(true);
    expect(v.issues[0]).toMatch(/…/);
  });

  it('a slide with long, many facts still fits what a version stores', () => {
    const [one] = staticSlideFacts(deck);
    const many = Array.from({ length: 30 }, (_, i) => `p "${'word '.repeat(80)}${i}"`);
    const merged = mergeSlideFacts(one!, { id: 'one', n: 1, overflowPx: 1, clipped: many, smallText: many, belowFooter: many, elementCount: 4, unknownElements: many, brokenImages: many });

    expect(merged.clipped).toHaveLength(12);
    expect(merged.clipped.every(c => c.length <= 200)).toBe(true);
    expect(merged.unknownElements.every(c => c.length <= 120)).toBe(true);
    expect(merged.unresolvedAssets.every(c => c.length <= 300)).toBe(true);
  });
});
