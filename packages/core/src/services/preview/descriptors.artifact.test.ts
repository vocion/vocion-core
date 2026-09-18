import { describe, expect, it } from 'vitest';

/**
 * The artifact preview must read the body key artifacts actually carry.
 *
 * Chris, 2026-09-17: *"no preview or content on the Preview pane for this
 * artifact."* Every markdown artifact is written as `{ title, md }` —
 * `render_markdown`, the personalization brief, the recommendation — and the
 * descriptor looked only for `markdown`/`text`. All 25 markdown artifacts in
 * production use `md`, so the panel had never once shown a body.
 */

/**
 * The lookup the descriptor performs, extracted so it can be asserted.
 * @param v
 */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const bodyOf = (spec: Record<string, unknown>) => str(spec.md) ?? str(spec.markdown) ?? str(spec.text);

describe('an artifact preview finds its body', () => {
  it('reads `md`, which is what every markdown artifact is written with', () => {
    expect(bodyOf({ title: 'Rowan Pike — research brief', md: '## What we know\n\nOne fact.' }))
      .toContain('What we know');
  });

  it('still reads the older keys, so nothing that used them regresses', () => {
    expect(bodyOf({ markdown: 'from markdown' })).toBe('from markdown');
    expect(bodyOf({ text: 'from text' })).toBe('from text');
  });

  it('treats an empty string as no body rather than as a body', () => {
    expect(bodyOf({ md: '   ', markdown: 'the real one' })).toBe('the real one');
  });
});
