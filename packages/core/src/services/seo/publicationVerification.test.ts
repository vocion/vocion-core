import type { SeoPageMeta } from './records';
import { beforeEach, expect, it, vi } from 'vitest';
import { PublicFetchError } from '@/libs/net/publicFetch';
import { identifyPublishedHtml, verifySeoPublication } from './publicationVerification';

const mocks = vi.hoisted(() => ({ getSeoPage: vi.fn(), readSeoRoadmap: vi.fn(), mergeMeta: vi.fn(), fetchPublic: vi.fn() }));
vi.mock('./records', () => ({ getSeoPage: mocks.getSeoPage, mergeMeta: mocks.mergeMeta }));
vi.mock('./roadmap', () => ({ readSeoRoadmap: mocks.readSeoRoadmap }));
vi.mock('@/libs/net/publicFetch', async original => ({ ...await original<typeof import('@/libs/net/publicFetch')>(), fetchPublic: mocks.fetchPublic }));
const url = 'https://northwind.example/guides/heating';
const title = 'Choosing a home heating system';
const content = `<html><head><title>${title} | Northwind</title></head><body><main><h1>${title}</h1>${'Heating choices need a careful comparison of comfort efficiency and operating costs. '.repeat(8)}</main></body></html>`;
const meta = { projectId: 9, status: 'published', publishedUrl: url, publishedAt: '2026-10-01', metaTitle: title } as SeoPageMeta;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSeoPage.mockResolvedValue({ id: 20, title, meta });
  mocks.readSeoRoadmap.mockResolvedValue({ canEdit: true, strategy: { id: 7 } });
  mocks.mergeMeta.mockImplementation(async (_org, _id, change) => ({ ...meta, ...change(meta) }));
  mocks.fetchPublic.mockResolvedValue({ finalUrl: url, res: new Response(content, { headers: { 'content-type': 'text/html; charset=utf-8' } }) });
});

it('checks only the stored published URL through guarded fetch and records dated identity evidence', async () => {
  const result = await verifySeoPublication('org-a', 20, 'owner', new Date('2026-10-30'));

  expect(result).toMatchObject({ status: 'verified', url, finalUrl: url, checkedAt: '2026-10-30T00:00:00.000Z', httpStatus: 200 });
  expect(mocks.getSeoPage).toHaveBeenCalledWith('org-a', 20);
  expect(mocks.readSeoRoadmap).toHaveBeenCalledWith('org-a', 9, 'owner');
  expect(mocks.fetchPublic).toHaveBeenCalledWith(url, expect.objectContaining({ timeoutMs: 10000, hops: 3 }));
  expect(mocks.mergeMeta).toHaveBeenCalledWith('org-a', 20, expect.any(Function));
});

it.each(['missing', 'nonowner', 'notpublished', 'no-url'])('refuses %s without any fetch', async (reason) => {
  if (reason === 'missing') {
    mocks.getSeoPage.mockResolvedValue(null);
  }
  if (reason === 'nonowner') {
    mocks.readSeoRoadmap.mockResolvedValue({ canEdit: false });
  }
  if (reason === 'notpublished') {
    mocks.getSeoPage.mockResolvedValue({ id: 20, title, meta: { ...meta, status: 'approved' } });
  }
  if (reason === 'no-url') {
    mocks.getSeoPage.mockResolvedValue({ id: 20, title, meta: { ...meta, publishedUrl: undefined } });
  }

  await expect(verifySeoPublication('org-a', 20, 'owner')).rejects.toThrow();
  expect(mocks.fetchPublic).not.toHaveBeenCalled();
  expect(mocks.mergeMeta).not.toHaveBeenCalled();
});

it.each([
  [new PublicFetchError('no access', 'http', 403), 'unverified'],
  [new PublicFetchError('timeout', 'network'), 'unverified'],
  [new PublicFetchError('private host', 'blocked'), 'unverified'],
  [new PublicFetchError('rate limited', 'http', 429), 'unverified'],
  [new PublicFetchError('missing', 'http', 404), 'failed'],
  [new PublicFetchError('gone', 'http', 410), 'failed'],
])('distinguishes missing URLs from unknown public access: %s', async (error, expected) => {
  mocks.fetchPublic.mockRejectedValue(error);

  expect((await verifySeoPublication('org-a', 20, 'owner')).status).toBe(expected);
});

it('does not verify a 200 soft-404 or a generic unrelated page', () => {
  expect(identifyPublishedHtml('<title>404 - Page not found</title><h1>Page not found</h1>', title).status).toBe('failed');
  expect(identifyPublishedHtml('<title>Welcome</title><h1>Home</h1>', title).status).toBe('unverified');
  expect(identifyPublishedHtml(`<title>${title}</title><body>Loading…</body>`, title).status).toBe('unverified');
});

it('does not verify an external redirect even if its page title matches', async () => {
  mocks.fetchPublic.mockResolvedValue({ finalUrl: 'https://unrelated.example/article', res: new Response(content, { headers: { 'content-type': 'text/html' } }) });

  expect((await verifySeoPublication('org-a', 20, 'owner')).status).toBe('unverified');
});

it('does not overwrite a changed page URL or newer verification after the fetch', async () => {
  mocks.mergeMeta.mockImplementation(async (_org, _id, change) => change({ ...meta, publishedUrl: 'https://northwind.example/new' }));

  await expect(verifySeoPublication('org-a', 20, 'owner')).rejects.toMatchObject({ status: 409 });

  mocks.mergeMeta.mockImplementation(async (_org, _id, change) => change({ ...meta, publicationVerification: { checkedAt: '2026-12-01' } }));

  await expect(verifySeoPublication('org-a', 20, 'owner', new Date('2026-10-30'))).rejects.toMatchObject({ status: 409 });
});

it('does not count stale URL evidence or future checks as verified delivery', async () => {
  const { publicationStanding } = await import('./publicationVerification');
  const check = { status: 'verified' as const, checkedAt: '2026-10-15', url, evidence: 'Matched title' };
  const result = publicationStanding([
    { meta: { ...meta, publicationVerification: check } },
    { meta: { ...meta, publicationVerification: { ...check, url: 'https://northwind.example/old' } } },
    { meta: { ...meta, publicationVerification: { ...check, checkedAt: '2026-12-01' } } },
    { meta: { ...meta, publicationVerification: { ...check, status: 'unverified' } } },
  ], new Date('2026-10-30'));

  expect(result).toEqual({ recordedPublished: 4, verified: 1, unverified: 1, failed: 0, notChecked: 2 });
});

it('leaves non-HTML and oversized responses unverified rather than claiming absence', async () => {
  mocks.fetchPublic.mockResolvedValueOnce({ finalUrl: url, res: new Response('data', { headers: { 'content-type': 'application/json' } }) });

  expect((await verifySeoPublication('org-a', 20, 'owner')).status).toBe('unverified');

  mocks.fetchPublic.mockResolvedValueOnce({ finalUrl: url, res: new Response(content, { headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) } }) });

  expect((await verifySeoPublication('org-a', 20, 'owner')).status).toBe('unverified');
});
