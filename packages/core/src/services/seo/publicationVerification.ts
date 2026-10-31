import type { PublicationVerification } from './publicationEvidence';
import type { SeoPageMeta } from './records';
import { load } from 'cheerio';
import { fetchPublic, PublicFetchError, readCapped } from '@/libs/net/publicFetch';
import { WriteApiError } from '@/services/writeApi';
import { isCurrentPublicationVerification } from './publicationEvidence';
import { getSeoPage, mergeMeta } from './records';
import { readSeoRoadmap } from './roadmap';

export type { PublicationVerification } from './publicationEvidence';

const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Public HTML identity check, not proof of indexing, rankings, or unchanged full content.
 * @param html
 * @param expectedTitle
 */
export function identifyPublishedHtml(html: string, expectedTitle: string): Pick<PublicationVerification, 'status' | 'evidence'> {
  const $ = load(html);
  $('script, style, nav, footer, header, noscript').remove();
  const title = $('title').first().text().trim();
  const h1 = $('h1').first().text().trim();
  if (/^(?:404(?:\b|\s)|page not found\b|not found$|access denied\b|sign in$|log in$)/i.test(title) || /^(?:404\b|page not found\b|not found$|access denied\b)/i.test(h1)) {
    return { status: 'failed', evidence: 'The public HTML identifies an error or access page, despite a successful HTTP response.' };
  }
  const expected = normalized(expectedTitle);
  const titleMatches = expected.length >= 8 && (normalized(title) === expected || normalized(title).startsWith(`${expected} `));
  const h1Matches = expected.length >= 8 && normalized(h1) === expected;
  const words = $('main, article').first().text().trim() || $('body').text().trim();
  if ((!titleMatches && !h1Matches) || words.split(/\s+/).filter(Boolean).length < 40) {
    return { status: 'unverified', evidence: 'HTTP succeeded, but readable HTML did not establish the expected title/H1 and substantive page content. A JavaScript render, different title, or access challenge may require manual review.' };
  }
  return { status: 'verified', evidence: `Public HTML matched the saved ${h1Matches ? 'heading' : 'title'} and contained readable page content. This verifies public availability and identity at check time, not indexing or search impact.` };
}

/**
 * Reads only a stored published URL under the client strategy owner's authority.
 * @param orgId
 * @param pageId
 * @param userId
 * @param now
 */
export async function verifySeoPublication(orgId: string, pageId: number, userId: string, now = new Date()): Promise<PublicationVerification> {
  const page = await getSeoPage(orgId, pageId);
  if (!page) {
    throw new WriteApiError(404, 'not_found', 'SEO page not found in this workspace.');
  }
  const roadmap = await readSeoRoadmap(orgId, page.meta.projectId, userId);
  if (!roadmap.canEdit || !roadmap.strategy) {
    throw new WriteApiError(403, 'forbidden', 'Only the approved client strategy owner can verify publication.');
  }
  if (page.meta.status !== 'published' || !page.meta.publishedUrl) {
    throw new WriteApiError(422, 'publication_not_recorded', 'This page needs a recorded published URL before it can be verified.');
  }
  const url = page.meta.publishedUrl;
  const expectedTitle = page.meta.metaTitle?.trim() || page.title;
  const base = { checkedAt: now.toISOString(), url, identity: { projectId: page.meta.projectId, publishedAt: page.meta.publishedAt ?? null, expectedTitle } };
  let result: PublicationVerification;
  try {
    const { res, finalUrl } = await fetchPublic(url, { timeoutMs: 10_000, hops: 3, headers: { 'User-Agent': 'VocionPublicationCheck/1.0', 'Accept': 'text/html,application/xhtml+xml' } });
    if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel().catch(() => {});
      result = { ...base, finalUrl, httpStatus: res.status, status: 'unverified', evidence: 'The public response was not identified as HTML; page identity was not verified.' };
    } else if (new URL(finalUrl).hostname.replace(/^www\./, '') !== new URL(url).hostname.replace(/^www\./, '')) {
      await res.body?.cancel().catch(() => {});
      result = { ...base, finalUrl, httpStatus: res.status, status: 'unverified', evidence: 'The saved URL redirects to another host. Review the publication URL before treating it as verified.' };
    } else {
      const html = (await readCapped(res, 2 * 1024 * 1024)).toString('utf8');
      result = { ...base, finalUrl, httpStatus: res.status, ...identifyPublishedHtml(html, expectedTitle) };
    }
  } catch (error) {
    const status = error instanceof PublicFetchError ? error.status : null;
    result = {
      ...base,
      ...(status ? { httpStatus: status } : {}),
      status: status === 404 || status === 410 ? 'failed' : 'unverified',
      evidence: status === 404 || status === 410 ? `The saved public URL returned HTTP ${status}.` : 'Public access could not be verified safely. A timeout, access restriction, non-public address, oversized response, or transient failure is not proof the page is absent.',
    };
  }
  const latest = await getSeoPage(orgId, pageId);
  if (!latest || (latest.meta.metaTitle?.trim() || latest.title) !== expectedTitle) {
    throw new WriteApiError(409, 'publication_changed', 'The page title changed during the check. Reload and retry.');
  }
  // Preserve concurrent edits and newer checks; a stale fetch cannot verify a new URL or publication.
  const written = await mergeMeta<SeoPageMeta>(orgId, pageId, (current) => {
    if (current.projectId !== page.meta.projectId || current.status !== 'published' || current.publishedUrl !== url || current.metaTitle !== page.meta.metaTitle || current.publishedAt !== page.meta.publishedAt || (current.publicationVerification && current.publicationVerification.checkedAt > result.checkedAt)) {
      throw new WriteApiError(409, 'publication_changed', 'The page or its verification changed during the check. Reload and retry.');
    }
    return { publicationVerification: result };
  });
  if (!written) {
    throw new WriteApiError(404, 'not_found', 'SEO page no longer exists in this workspace.');
  }
  return result;
}

/**
 * Current URL checks only; a previous URL's evidence does not verify a replacement.
 * @param pages
 * @param now
 */
export function publicationStanding(pages: readonly { title?: string; meta: SeoPageMeta }[], now = new Date()) {
  const result = { recordedPublished: 0, verified: 0, failed: 0, unverified: 0, notChecked: 0 };
  for (const page of pages.filter(p => p.meta.status === 'published')) {
    result.recordedPublished++;
    const check = page.meta.publicationVerification;
    if (!isCurrentPublicationVerification(check, { ...page.meta, expectedTitle: page.meta.metaTitle?.trim() || page.title || '' }, now)) {
      result.notChecked++;
    } else if (check!.status === 'verified') {
      result.verified++;
    } else if (check!.status === 'failed') {
      result.failed++;
    } else {
      result.unverified++;
    }
  }
  return result;
}
