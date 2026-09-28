import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ConversationSkeleton, ListSkeleton, ReportSkeleton } from './Skeletons';
import '@/styles/global.css';

/**
 * The three loading shapes (backlog 013), at a phone width: each is one
 * busy region with a label and no words, and none of them pushes the page
 * sideways — a skeleton that scrolls horizontally on a phone is worse than
 * no skeleton.
 */

const SHAPES = [
  ['list', ListSkeleton],
  ['report', ReportSkeleton],
  ['conversation', ConversationSkeleton],
] as const;

describe('the loading skeletons', () => {
  for (const [name, Skeleton] of SHAPES) {
    it(`${name}: one labelled busy region, no words, fits a phone`, async () => {
      await page.viewport(390, 844);
      await render(<Skeleton />);

      const host = document.querySelector(`[data-skeleton="${name}"]`) as HTMLElement;

      expect(host).not.toBeNull();
      expect(host.getAttribute('aria-busy')).toBe('true');
      expect(host.getAttribute('aria-label')).toBe('Loading');
      expect(host.getBoundingClientRect().height).toBeGreaterThan(100);
      expect(host.textContent?.trim()).toBe('');
      expect(host.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
      expect(document.scrollingElement!.scrollWidth).toBeLessThanOrEqual(document.scrollingElement!.clientWidth);
    });
  }
});
