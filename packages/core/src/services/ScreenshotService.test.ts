import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, knowledgeDocumentSchema, knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { findScreenshots, publiclyFetchable, screenshotsFromLibrary } = await import('./ScreenshotService');

const ORG = 'org_shots';
const ACCOUNT = 'acct_shots';

beforeEach(async () => {
  await db.delete(artifactSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
  await db.delete(projectSchema);
  await db.delete(tenantAccountSchema);
  await db.insert(tenantAccountSchema).values({ id: ACCOUNT, name: 'Acct', slug: 'acct-shots' });
  await db.insert(projectSchema).values({ id: ORG, accountId: ACCOUNT, slug: 'workforce', name: 'Workforce' });
});

describe('publiclyFetchable', () => {
  it('is the difference between an image Slack can render and one it cannot', () => {
    expect(publiclyFetchable('https://cdn.example.test/a.png')).toBe(true);
    expect(publiclyFetchable('/api/artifacts/x/a.png')).toBe(false);
    expect(publiclyFetchable('https://app.example.test/api/artifacts/x/a.png')).toBe(false);
  });
});

describe('findScreenshots', () => {
  it('finds a release post\'s hero image and an image artifact, and says which are fetchable', async () => {
    const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, projectId: ORG, slug: 'site', kind: 'web', configJson: {} }).returning();
    await db.insert(knowledgeDocumentSchema).values({
      orgId: ORG,
      projectId: ORG,
      sourceId: source!.id,
      externalId: 'releases/2-80-1',
      uri: 'https://example.test/releases/2-80-1',
      title: 'Release 2.80.1 — the inbox is one list',
      contentHash: 'h1',
      metadata: {
        ogImage: 'https://cdn.example.test/releases/2-80-1.png',
        links: [{ url: 'https://cdn.example.test/releases/inbox-detail.png', text: 'detail' }, { url: 'https://example.test/docs', text: 'docs' }],
      },
    });
    await db.insert(artifactSchema).values({
      orgId: ORG,
      projectId: ORG,
      kind: 'file',
      title: 'Release 2.80.1 inbox screenshot',
      spec: { filename: 'inbox.png', contentType: 'image/png', bytes: 1024, url: '/api/artifacts/abc/inbox.png' },
    });
    // Not an image — must not come back as one.
    await db.insert(artifactSchema).values({ orgId: ORG, projectId: ORG, kind: 'link', title: 'Release 2.80.1 notes', spec: { href: 'https://example.test/releases/2-80-1', title: 'notes' } });

    const { screenshots, searched } = await findScreenshots({ orgId: ORG, query: 'release 2.80.1' });

    expect(searched).toEqual(['site', 'artifact']);
    expect(screenshots.map(s => s.url)).toEqual([
      'https://cdn.example.test/releases/2-80-1.png',
      'https://cdn.example.test/releases/inbox-detail.png',
      '/api/artifacts/abc/inbox.png',
    ]);
    // The site's images are on public URLs; the artifact is behind our auth.
    expect(screenshots.map(s => s.publiclyFetchable)).toEqual([true, true, false]);
    expect(screenshots[0]!.source).toBe('site');
    expect(screenshots[2]!.source).toBe('artifact');
  });

  it('finds nothing for another org', async () => {
    await db.insert(artifactSchema).values({ orgId: 'org_other', kind: 'file', title: 'shot', spec: { filename: 'a.png', contentType: 'image/png', bytes: 1, url: 'https://cdn.example.test/a.png' } });

    expect((await findScreenshots({ orgId: ORG, query: '' })).screenshots).toEqual([]);
  });
});

describe('screenshotsFromLibrary', () => {
  it('contributes nothing, and claims nothing, when no library is registered', async () => {
    delete process.env.VOCION_SCREENSHOT_LIBRARY;

    expect(await screenshotsFromLibrary('', 5)).toEqual([]);
    expect((await findScreenshots({ orgId: ORG, query: '' })).searched).not.toContain('library');
  });

  it('reads a registered manifest', async () => {
    process.env.VOCION_SCREENSHOT_LIBRARY = '/fixtures/shots.json';
    try {
      const shots = await screenshotsFromLibrary('inbox', 5, async () => JSON.stringify([
        { url: 'https://cdn.example.test/fixtures/inbox.png', caption: 'The inbox', shows: 'one list of asks' },
        { url: 'https://cdn.example.test/fixtures/deals.png', caption: 'Deals board' },
      ]));

      expect(shots).toEqual([{ url: 'https://cdn.example.test/fixtures/inbox.png', caption: 'The inbox', shows: 'one list of asks', source: 'library', publiclyFetchable: true }]);
    } finally {
      delete process.env.VOCION_SCREENSHOT_LIBRARY;
    }
  });
});
