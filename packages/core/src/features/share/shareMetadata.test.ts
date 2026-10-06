import type { PublicFeaturePage } from '@/services/factory/featureShare';
import { describe, expect, it } from 'vitest';
import { requestOrigin } from '@/libs/http/publicOrigin';
import { sharedFeatureMetadata } from './shareMetadata';

/**
 * A shared feature unfurls where it is pasted (Chris, 2026-10-03: "share
 * metadata for Slack unfurls"): the name, who built it with how long and the
 * cost, the first mockup as an absolute picture — and it is still never
 * indexed. Fictional fixture (Northwind).
 */

function page(over: Partial<PublicFeaturePage> = {}): PublicFeaturePage {
  return {
    title: 'Upload date on each library row',
    builtBy: 'Northwind Studio',
    workspaceName: 'Northwind Studio',
    productName: null,
    openUrl: '/w/northwind-studio/dashboard/p/feature/370',
    status: { word: 'Shipped', at: '2026-10-02T08:30:32.000Z', live: null },
    media: [
      { kind: 'video', src: '/api/share/feature/TOKEN/media/951?k=s1', type: 'video/webm', label: 'Walkthrough', caption: 'A walk through it' },
      { kind: 'image', src: '/api/share/feature/TOKEN/media/962?k=s2', label: 'QA after', alt: 'Library · desktop · after', caption: null },
      { kind: 'image', src: '/api/share/feature/TOKEN/media/901?k=s3', label: 'Mockup', alt: 'Library rows with dates', caption: 'The proposed row', width: 1200, height: 630 },
    ],
    ask: { kind: 'asked', text: 'Show the upload date on each row.', by: 'Dana Okafor', at: '2026-10-02T07:12:00.000Z' },
    built: 'Library rows show when each file was uploaded.',
    effort: { duration: '1h 12m', from: 'ask', until: 'seen live', attempts: 2, total: '$4.80', split: [], timeSplit: [] },
    timeline: [],
    ...over,
  };
}

const ORIGIN = 'https://agents.northwind.example';

describe('a shared feature\'s metadata', () => {
  it('unfurls to the name, the time and the cost, the workspace, and the first mockup', () => {
    const meta = sharedFeatureMetadata(page(), ORIGIN);
    const description = 'Built by Northwind Studio in 1h 12m for $4.80 · Library rows show when each file was uploaded.';

    expect(meta.title).toBe('Upload date on each library row');
    expect(meta.openGraph).toEqual({
      type: 'article',
      title: 'Upload date on each library row · 1h 12m · $4.80',
      description,
      siteName: 'Northwind Studio',
      images: [{ url: `${ORIGIN}/api/share/feature/TOKEN/media/901?k=s3`, alt: 'The proposed row', width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({ card: 'summary_large_image', description, images: [{ url: `${ORIGIN}/api/share/feature/TOKEN/media/901?k=s3` }] });
    expect(String((meta.openGraph as { title: string }).title).length).toBeLessThan(70);
    expect(description.length).toBeLessThanOrEqual(200);
  });

  it('names the product it was built for, where the work names one', () => {
    const meta = sharedFeatureMetadata(page({ productName: 'Ledger' }), ORIGIN);

    expect((meta.openGraph as { description: string }).description).toBe('Built by Northwind Studio for Ledger in 1h 12m for $4.80 · Library rows show when each file was uploaded.');
  });

  it('pictures QA\'s first shot when there is no mockup, and none when there is neither', () => {
    const noMockup = sharedFeatureMetadata(page({ media: page().media.slice(0, 2) }), ORIGIN);

    expect((noMockup.openGraph as { images: Array<{ url: string }> }).images[0]!.url).toBe(`${ORIGIN}/api/share/feature/TOKEN/media/962?k=s2`);

    const none = sharedFeatureMetadata(page({ media: page().media.slice(0, 1) }), ORIGIN);

    expect(none.openGraph).not.toHaveProperty('images');
    expect(none.twitter).toMatchObject({ card: 'summary' });
  });

  it('falls back to the factory as the builder and Vocion as the site', () => {
    const meta = sharedFeatureMetadata(page({ builtBy: 'Vocion Software Factory' }), ORIGIN);

    expect((meta.openGraph as { siteName: string }).siteName).toBe('Vocion');
    expect((meta.openGraph as { description: string }).description.startsWith('Built by Vocion Software Factory in 1h 12m for $4.80')).toBe(true);
  });

  it('is never indexed, followed or referred, found or not', () => {
    for (const meta of [sharedFeatureMetadata(page(), ORIGIN), sharedFeatureMetadata(null, ORIGIN)]) {
      expect(meta.robots).toMatchObject({ index: false, follow: false });
      expect(meta.referrer).toBe('no-referrer');
    }

    expect(sharedFeatureMetadata(null, ORIGIN).title).toBe('Not found');
  });
});

describe('the origin a request came in on', () => {
  it('reads the proxy\'s forwarded host and scheme, else the host', () => {
    expect(requestOrigin(new Headers({ 'x-forwarded-host': 'agents.northwind.example', 'x-forwarded-proto': 'https', 'host': '0.0.0.0:3000' }))).toBe('https://agents.northwind.example');
    expect(requestOrigin(new Headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(requestOrigin(new Headers({ host: 'agents.northwind.example' }))).toBe('https://agents.northwind.example');
    expect(requestOrigin(new Headers())).toBeNull();
  });
});
