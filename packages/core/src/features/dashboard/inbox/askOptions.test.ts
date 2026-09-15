import { describe, expect, it } from 'vitest';
import { FIXED_ROWS, labelFor, OTHER } from './askOptions';

describe('labelFor', () => {
  it("names the ask's own option", () => {
    const ask = { options: [{ id: 'a-github-action-family', label: 'Add github.* family', description: '' }] };
    expect(labelFor(ask, 'a-github-action-family')).toBe('Add github.* family');
  });

  it('falls back to the fixed rows when the ask names no options', () => {
    expect(labelFor({ options: [] }, 'approve')).toBe('Approve');
    expect(labelFor({ options: [] }, 'reject')).toBe('Reject');
    expect(labelFor({ options: [] }, 'done')).toBe('Mark done');
  });

  it('labels a free-text answer', () => {
    expect(labelFor({ options: [] }, OTHER)).toBe('Other');
  });

  it('returns the raw id rather than nothing when the option is gone', () => {
    expect(labelFor({ options: [] }, 'retired-option')).toBe('retired-option');
  });

  it('is importable from a server module — no client-only dependency', () => {
    // The whole point of this module: it must not pull in 'use client' code.
    // A regression here shows up as "Attempted to call labelFor() from the
    // server" in production, not as a failure at build time.
    expect(FIXED_ROWS).toHaveLength(3);
  });
});
