import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { nestedSurfaceWarning, resetSurfaceWarnings, Surface, SurfaceSection } from './surface';

/**
 * The Never rule, enforced where rules hold — at runtime, in development.
 * A warning and not a throw: a design rule must not be able to take a page
 * down (docs/design/patterns.md).
 */

beforeEach(() => {
  resetSurfaceWarnings();
});

describe('the nested-surface guard', () => {
  it('says nothing about one surface, however much it holds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(
        <Surface name="brief" className="p-5">
          <SurfaceSection first eyebrow="Sequence overview" title="Enroll in: two sends">
            <p>the overview</p>
          </SurfaceSection>
          <SurfaceSection eyebrow="Send 1 of 2 · Day 0" actions={<button type="button">Looks good</button>}>
            <p>the draft</p>
          </SurfaceSection>
        </Surface>,
      );

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('names the rule, and both surfaces, when one contains another', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(
        <Surface name="rail">
          <Surface name="guided review">a card in a card</Surface>
        </Surface>,
      );

      expect(warn).toHaveBeenCalledWith(nestedSurfaceWarning('guided review'));
      expect(nestedSurfaceWarning('guided review')).toContain('never contains another bordered surface');
    } finally {
      warn.mockRestore();
    }
  });

  it('warns once per surface, so forty rows print one line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await render(
        <Surface name="list">
          {[1, 2, 3, 4].map(n => <Surface key={n} name="row">{n}</Surface>)}
        </Surface>,
      );

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('nests with a hairline and an eyebrow instead of a border — the first block takes neither', async () => {
    const screen = await render(
      <Surface name="brief">
        <SurfaceSection first eyebrow="First">a</SurfaceSection>
        <SurfaceSection eyebrow="Second">b</SurfaceSection>
      </Surface>,
    );
    const blocks = [...screen.container.querySelectorAll('div > div')].filter(el => el.querySelector('div')?.textContent === 'First' || el.querySelector('div')?.textContent === 'Second');

    expect(blocks[0]!.className).not.toContain('border-t');
    expect(blocks[1]!.className).toContain('border-t');
    expect(blocks[1]!.className).toContain('border-rule');
  });
});
