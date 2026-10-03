import type { Metadata } from 'next';
import type { PublicFeaturePage } from '@/services/factory/featureShare';
import { shareCard } from '@/services/factory/featureShare';

/** Never indexed, never followed, never cached by a search engine. An unfurler still reads the card. */
const NOINDEX: Metadata['robots'] = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };

/**
 * A shared feature's page metadata (Chris, 2026-10-03: "share metadata for
 * Slack unfurls"): the name as the title, and an Open Graph / Twitter card
 * whose title, description, site and picture come from `shareCard` — the
 * page's own figures, the workspace's own name and the first mockup, served
 * through the link. Still never indexed and no referrer leaves it: robots
 * `noindex` does not stop a chat app unfurling a link a person pasted.
 * @param page - The page, or null for a link that opens nothing.
 * @param origin - The origin the request came in on, for the picture's absolute URL.
 */
export function sharedFeatureMetadata(page: PublicFeaturePage | null, origin: string | null): Metadata {
  if (!page) {
    return { title: 'Not found', robots: NOINDEX, referrer: 'no-referrer' };
  }
  const card = shareCard(page, origin ?? 'http://localhost');
  const image = origin ? card.image : null;
  const images = image ? [{ url: image.url, alt: image.alt, ...(image.width && image.height ? { width: image.width, height: image.height } : {}) }] : undefined;
  return {
    title: page.title,
    description: card.description,
    robots: NOINDEX,
    referrer: 'no-referrer',
    openGraph: {
      type: 'article',
      title: card.title,
      description: card.description,
      siteName: card.siteName,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: card.title,
      description: card.description,
      ...(images ? { images } : {}),
    },
  };
}
