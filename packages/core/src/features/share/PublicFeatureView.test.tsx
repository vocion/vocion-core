import type { PublicFeaturePage } from '@/services/factory/featureShare';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page as browser } from 'vitest/browser';
import { PublicFeatureView } from './PublicFeatureView';
import '@/styles/global.css';

/**
 * A feature's public page, drawn on a phone first (390px) and at a desk: the
 * six parts in order, nothing wider than the screen, and no name when the
 * sharer hid it. Fictional fixture (Northwind).
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fixture(over: Partial<PublicFeaturePage> = {}): PublicFeaturePage {
  return {
    title: 'Show the upload date on each library row, so a board pack never carries a stale file again',
    ask: {
      text: 'I cannot tell which file is newest. Show the upload date on each row.\n\nAnd please keep the list sorted newest first — averyveryveryveryveryveryveryveryverylongwordwithoutanyspacesatall.',
      by: 'Dana Okafor',
      at: '2026-10-02T07:12:00.000Z',
    },
    built: 'Library rows show when each file was uploaded.',
    effort: { duration: '1h 19m', until: 'seen live', attempts: 2, total: '$2.33', split: [{ label: 'Builds', amount: '$1.81' }, { label: 'Agents', amount: '$0.40' }, { label: 'Chat', amount: '$0.12' }] },
    pictures: [
      { src: PNG, label: 'Mockup', alt: 'Library rows with dates', caption: 'The proposed row' },
      { src: `${PNG}#after`, label: 'After', alt: 'Library rows, live', caption: null },
    ],
    video: { kind: 'file', src: '/api/share/feature/TOKEN/media/951?k=sig', type: 'video/webm', label: 'On the live product', caption: 'Live check of REL-9', at: '2026-10-02T08:32:00.000Z' },
    timeline: [
      { step: 'Asked', at: '2026-10-02T07:12:00.000Z' },
      { step: 'Plan approved', at: '2026-10-02T07:14:00.000Z' },
      { step: 'Built', at: '2026-10-02T08:18:00.000Z' },
      { step: 'QA approved', at: '2026-10-02T08:22:22.000Z' },
      { step: 'Merged', at: '2026-10-02T08:22:25.000Z' },
      { step: 'Released', at: '2026-10-02T08:30:32.000Z' },
      { step: 'Seen live', at: '2026-10-02T08:31:53.000Z' },
    ],
    ...over,
  };
}

afterEach(async () => {
  await browser.viewport(1440, 900);
});

describe('a feature\'s public page', () => {
  it('draws the ask and who asked, what it built, time and cost, mockups, the walkthrough and the timeline, in that order', async () => {
    await browser.viewport(390, 844);
    await render(<PublicFeatureView page={fixture()} />);

    const order = ['public-ask', 'public-built', 'public-effort', 'public-mockups', 'public-video', 'public-timeline'];
    const sections = order.map(id => document.querySelector(`[data-testid="${id}"]`));

    expect(sections.every(Boolean)).toBe(true);

    const tops = sections.map(s => s!.getBoundingClientRect().top);

    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(document.querySelector('[data-testid="public-asker"]')!.textContent).toMatch(/^Dana Okafor · /);
    expect(sections[1]!.textContent).toContain('Library rows show when each file was uploaded.');
    expect(sections[2]!.textContent).toContain('1h 19m, from the ask to seen live');
    expect(sections[2]!.textContent).toContain('$2.33');
    expect(sections[2]!.textContent).toContain('builds $1.81 · agents $0.40 · chat $0.12');
    expect(sections[3]!.querySelectorAll('img')).toHaveLength(2);
    expect(sections[4]!.querySelector('video source')!.getAttribute('src')).toBe('/api/share/feature/TOKEN/media/951?k=sig');
    expect([...sections[5]!.querySelectorAll('li')].map(li => li.textContent?.split(/\d/)[0])).toEqual(['Asked', 'Plan approved', 'Built', 'QA approved', 'Merged', 'Released', 'Seen live']);
  });

  it('never scrolls sideways on a phone', async () => {
    await browser.viewport(390, 844);
    await render(<PublicFeatureView page={fixture()} />);
    const main = document.querySelector('[data-testid="public-feature"]') as HTMLElement;

    expect(main.getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

    for (const el of main.querySelectorAll('section, img, video, blockquote, dd')) {
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(390 + 0.5);
    }
  });

  it('says only when they asked when the sharer hid who asked', async () => {
    await render(<PublicFeatureView page={fixture({ ask: { ...fixture().ask, by: null } })} />);

    const asker = document.querySelector('[data-testid="public-asker"]')!;

    expect(asker.textContent).toMatch(/^Asked /);
    expect(document.body.textContent).not.toContain('Dana Okafor');
  });

  it('frames the video host\'s player for a public recording, and leaves out parts with nothing in them', async () => {
    await render(<PublicFeatureView page={fixture({ pictures: [], video: { kind: 'embed', src: 'https://video-host.example/embed/share-fictional-1', label: 'Walkthrough', caption: 'A walk through it', at: '2026-10-02T09:00:00.000Z' } })} />);

    expect(document.querySelector('[data-testid="public-mockups"]')).toBeNull();
    expect(document.querySelector('[data-testid="public-video"] iframe')!.getAttribute('src')).toBe('https://video-host.example/embed/share-fictional-1');
  });

  it('links nowhere back into the workspace', async () => {
    await render(<PublicFeatureView page={fixture()} />);

    expect(document.querySelectorAll('[data-testid="public-feature"] a')).toHaveLength(0);
  });
});
