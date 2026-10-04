import type { PublicFeaturePage } from '@/services/factory/featureShare';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page as browser, userEvent } from 'vitest/browser';
import { builtLine } from '@/libs/factory/featureGlance';
import { PublicFeatureView } from './PublicFeatureView';
import { stepClock } from './PublicTimeline';
import '@/styles/global.css';

/**
 * A feature's public page, drawn on a phone first (390px) and at a desk: the
 * name, the headline numbers, who built it, the carousel right under them
 * (walkthrough, mockups, QA's shots — each opens full screen), the ask, what
 * it built, the figures at a glance and the timeline; nothing wider than the
 * screen, and no name when the sharer hid it. Fictional fixture (Northwind).
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SENTENCE = 'QA checked the change against what was asked and approved it.';

function fixture(over: Partial<PublicFeaturePage> = {}): PublicFeaturePage {
  return {
    title: 'Upload date on each library row',
    builtBy: 'Northwind Studio',
    workspaceName: 'Northwind Studio',
    productName: 'Ledger',
    openUrl: '/w/northwind-studio/dashboard/p/feature/370',
    status: { word: 'Shipped', at: '2026-10-02T08:30:32.000Z' },
    media: [
      { kind: 'video', src: '/api/share/feature/TOKEN/media/951?k=sig', type: 'video/webm', label: 'On the live product', caption: 'Live check of the library' },
      { kind: 'image', src: PNG, label: 'Mockup', alt: 'Library rows with dates', caption: 'The proposed row' },
      { kind: 'image', src: `${PNG}#qa`, label: 'QA after', alt: 'Library · desktop · after', caption: null },
    ],
    ask: {
      text: 'I cannot tell which file is newest. Show the upload date on each row.\n\nAnd please keep the list sorted newest first — averyveryveryveryveryveryveryveryverylongwordwithoutanyspacesatall.',
      by: 'Dana Okafor',
      at: '2026-10-02T07:12:00.000Z',
    },
    built: 'Library rows show when each file was uploaded.',
    effort: {
      duration: '1h 19m',
      until: 'seen live',
      attempts: 2,
      total: '$2.33',
      split: [{ label: 'Builds', amount: '$1.81' }, { label: 'Agents', amount: '$0.40' }, { label: 'Chat', amount: '$0.12' }],
      timeSplit: [{ label: 'Plan', amount: '2m' }, { label: 'Build', amount: '59m' }, { label: 'QA', amount: '8m' }, { label: 'Release', amount: '8m' }, { label: 'Live check', amount: '1m' }],
    },
    timeline: [
      { step: 'Asked', at: '2026-10-02T07:12:00.000Z', took: '2 min', sentence: 'The ask came in and was filed as a feature.' },
      { step: 'Plan approved', at: '2026-10-02T07:14:00.000Z', took: '1 h 4 min', sentence: 'The plan was approved, so building could start.' },
      { step: 'Built', at: '2026-10-02T08:18:00.000Z', took: '4 min', sentence: 'An engineer agent built the change and sent it for review.' },
      { step: 'QA approved', at: '2026-10-02T08:22:22.000Z', took: 'under a minute', sentence: SENTENCE },
      { step: 'Merged', at: '2026-10-02T08:22:25.000Z', took: '8 min', sentence: 'The change was merged into the product\'s code.' },
      { step: 'Released', at: '2026-10-02T08:30:32.000Z', took: '1 min', sentence: 'The change went out in a release.' },
      { step: 'Seen live', at: '2026-10-03T08:31:53.000Z', took: null, sentence: 'QA opened the live product and saw it working.' },
    ],
    ...over,
  };
}

afterEach(async () => {
  await browser.viewport(1440, 900);
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`);

describe('a feature\'s public page', () => {
  it('leads with the name, the headline numbers and who built it, then the carousel, the ask, what it built, the figures and the timeline', async () => {
    await browser.viewport(390, 844);
    await render(<PublicFeatureView page={fixture()} />);

    const order = ['public-topbar', 'public-subhead', 'public-status', 'public-media', 'public-ask', 'public-built', 'public-effort', 'public-timeline'];
    const sections = order.map(q);

    expect(sections.every(Boolean)).toBe(true);

    const tops = sections.map(s => s!.getBoundingClientRect().top);

    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(document.querySelector('h1')!.textContent).toBe('Upload date on each library row');
    expect(q('public-status')!.textContent).toMatch(/^Shipped \d/);
    expect(q('public-identity')!.textContent).toBe('NSNorthwind Studio/Ledger');
    expect(q('public-asker')!.textContent).toMatch(/^Dana Okafor · /);
    expect(q('public-built')!.textContent).toContain('Library rows show when each file was uploaded.');
  });

  it('says how long and what it cost as the subhead, the same words as the link\'s preview, numbers set in weight', async () => {
    await render(<PublicFeatureView page={fixture()} />);
    const subhead = q('public-subhead')!;

    expect(subhead.textContent).toBe('Built in 1h 19m for $2.33');
    expect(subhead.textContent).toBe(builtLine(fixture().effort));
    expect([...subhead.querySelectorAll('strong')].map(s => s.textContent)).toEqual(['1h 19m', '$2.33']);
    expect(Number.parseFloat(getComputedStyle(subhead).fontSize)).toBeGreaterThan(Number.parseFloat(getComputedStyle(q('public-built')!.querySelector('p')!).fontSize));
  });

  it('leaves out a missing number, and the whole subhead with neither', async () => {
    const { unmount } = await render(<PublicFeatureView page={fixture({ effort: { ...fixture().effort, total: null } })} />);

    expect(q('public-subhead')!.textContent).toBe('Built in 1h 19m');

    await unmount();
    await render(<PublicFeatureView page={fixture({ effort: { ...fixture().effort, total: null, duration: null } })} />);

    expect(q('public-subhead')).toBeNull();
  });

  it('shows the three figures at a glance, with where the time and the cost went one tap away', async () => {
    await render(<PublicFeatureView page={fixture()} />);

    const stat = (key: string) => [q(`public-stat-${key}`)!.querySelector('dd')!.textContent, q(`public-stat-${key}`)!.querySelector('dt')!.textContent];

    expect(stat('duration')).toEqual(['1h 19m', 'ask to seen live']);
    expect(stat('attempts')).toEqual(['2', 'attempts']);
    expect(stat('cost')).toEqual(['$2.33', 'total cost']);
    // The value sits above its label.
    expect(q('public-stat-cost')!.querySelector('dd')!.getBoundingClientRect().top).toBeLessThan(q('public-stat-cost')!.querySelector('dt')!.getBoundingClientRect().top);

    const time = q('public-time-split') as HTMLDetailsElement;
    const cost = q('public-cost-split') as HTMLDetailsElement;

    expect(time.open).toBe(false);
    expect(cost.open).toBe(false);

    await userEvent.click(cost.querySelector('summary')!);

    expect(cost.open).toBe(true);
    expect(cost.textContent).toContain('Builds $1.81 · Agents $0.40 · Chat $0.12');
    expect(time.textContent).toContain('Plan 2m · Build 59m · QA 8m · Release 8m · Live check 1m');
  });

  it('puts the walkthrough first in the carousel, then the mockups, then QA\'s shots — and a tap opens it full screen', async () => {
    await render(<PublicFeatureView page={fixture()} />);
    const slides = [...q('public-media')!.querySelectorAll('[data-testid="report-slide"]')];

    expect(slides).toHaveLength(3);
    expect(slides[0]!.querySelector('[data-testid="report-slide-video"]')).not.toBeNull();
    expect(slides[1]!.querySelector('img')!.getAttribute('alt')).toBe('The proposed row');
    expect(slides[2]!.querySelector('img')!.getAttribute('alt')).toBe('Library · desktop · after');

    await userEvent.click(slides[0] as HTMLElement);

    const video = q('report-lightbox-video') as HTMLVideoElement;

    expect(q('report-lightbox')).not.toBeNull();
    expect(video.querySelector('source')!.getAttribute('src')).toBe('/api/share/feature/TOKEN/media/951?k=sig');
    expect(video.controls).toBe(true);

    await userEvent.keyboard('{Escape}');
    await userEvent.click(slides[1] as HTMLElement);

    expect(q('report-lightbox-image')!.getAttribute('src')).toBe(PNG);
  });

  it('moves the carousel with the left and right arrows, from a thumbnail too', async () => {
    await render(<PublicFeatureView page={fixture()} />);
    const tabs = [...q('report-thumbs')!.querySelectorAll('[role="tab"]')] as HTMLElement[];

    tabs[0]!.focus();
    await userEvent.keyboard('{ArrowRight}');

    await expect.poll(() => tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs[1]);

    await userEvent.keyboard('{ArrowLeft}');

    await expect.poll(() => tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('reads the timeline as a time of day, the date only when it changes, how long to the next step and a sentence', async () => {
    await render(<PublicFeatureView page={fixture()} />);
    const steps = [...document.querySelectorAll('[data-testid="public-step"]')];
    const clock = stepClock(fixture().timeline);

    expect(steps).toHaveLength(7);
    expect(steps.map(s => s.querySelector('[data-testid="public-step-time"]')!.textContent)).toEqual(clock.map(c => c.time));
    expect(clock.every(c => /^\d{1,2}:\d{2}\s?[AP]M$/.test(c.time))).toBe(true);
    // A date on the first step and where the day changes, nowhere else.
    expect(steps.map(s => s.querySelector('[data-testid="public-step-day"]') !== null)).toEqual(clock.map(c => c.day !== null));
    expect(clock[0]!.day).not.toBeNull();
    expect(clock.filter(c => c.day !== null).length).toBeLessThan(clock.length);
    expect(steps[3]!.querySelector('[data-testid="public-step-took"]')!.textContent).toBe('under a minute');
    expect(steps[3]!.querySelector('[data-testid="public-step-sentence"]')!.textContent).toBe(SENTENCE);
    expect(steps[6]!.querySelector('[data-testid="public-step-took"]')).toBeNull();
  });

  it('never scrolls sideways on a phone', async () => {
    await browser.viewport(390, 844);
    await render(<PublicFeatureView page={fixture()} />);
    const main = q('public-feature') as HTMLElement;

    expect(main.getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);

    for (const el of main.querySelectorAll('section, h1, p, [data-testid="report-carousel"], blockquote, dl, ol')) {
      expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(390 + 0.5);
    }
  });

  it('says only when they asked when the sharer hid who asked', async () => {
    await render(<PublicFeatureView page={fixture({ ask: { ...fixture().ask, by: null } })} />);

    expect(q('public-asker')!.textContent).toMatch(/^Asked /);
    expect(document.body.textContent).not.toContain('Dana Okafor');
  });

  it('leaves out parts with nothing in them', async () => {
    await render(<PublicFeatureView page={fixture({ media: [], timeline: [] })} />);

    expect(q('public-media')).toBeNull();
    expect(q('public-timeline')).toBeNull();
  });

  it('shows the workspace alone when the work names no product', async () => {
    await render(<PublicFeatureView page={fixture({ productName: null })} />);

    expect(q('public-workspace')!.textContent).toBe('Northwind Studio');
    expect(q('public-product')).toBeNull();
  });

  it('opens the feature in the workspace from one button top right, with its tooltip, and links nowhere else', async () => {
    await browser.viewport(1440, 900);
    await render(<PublicFeatureView page={fixture()} />);
    const open = q('public-open') as HTMLAnchorElement;
    const bar = q('public-topbar')!.getBoundingClientRect();

    expect(document.querySelectorAll('[data-testid="public-feature"] a')).toHaveLength(1);
    expect(open.getAttribute('href')).toBe('/w/northwind-studio/dashboard/p/feature/370');
    expect(open.getAttribute('aria-label')).toBe('Open in Northwind Studio');
    expect(open.hasAttribute('title')).toBe(false);
    expect(open.textContent).toBe('Open');
    expect(open.getBoundingClientRect().right).toBeCloseTo(bar.right, 0);

    await userEvent.hover(open);

    await expect.poll(() => document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain('Open in Northwind Studio');
  });

  it('drops the button\'s word on a narrow phone and keeps its name', async () => {
    await browser.viewport(390, 844);
    await render(<PublicFeatureView page={fixture()} />);
    const open = q('public-open') as HTMLAnchorElement;

    expect(open.querySelector('span')!.getBoundingClientRect().width).toBe(0);
    expect(open.getAttribute('aria-label')).toBe('Open in Northwind Studio');
    expect(open.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  });

  it('has no link back in when the sharer turned the button off', async () => {
    await render(<PublicFeatureView page={fixture({ openUrl: null })} />);

    expect(document.querySelectorAll('[data-testid="public-feature"] a')).toHaveLength(0);
  });
});
