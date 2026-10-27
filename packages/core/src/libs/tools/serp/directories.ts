/**
 * Directories, marketplaces, social sites and reference sites: domains that
 * rank for a query because they list everyone, not because their page is the
 * kind a business could write. On a local or home-services results page they
 * can take half the top ten, and counting them skews everything a brief
 * derives from the top pages (the median length, the headings they share,
 * what "every ranking page covers").
 *
 * So the SERP tools keep them in the results and in the brief, flagged, and
 * leave them out of anything aggregated. One shared list: onboarding's
 * competitor detection reads the same one, so a directory is never mistaken
 * for a competitor either.
 *
 * Data, not behaviour: add a domain here and every reader follows.
 */

/** Registrable domains, lower case, without `www.`. A subdomain matches its parent. */
export const DIRECTORY_DOMAINS: readonly string[] = [
  // Reviews and local directories
  'yelp.com',
  'yelp.ca',
  'yelp.co.uk',
  'bbb.org',
  'yellowpages.com',
  'yellowpages.ca',
  'superpages.com',
  'manta.com',
  'mapquest.com',
  'chamberofcommerce.com',
  'citysearch.com',
  'merchantcircle.com',
  'tripadvisor.com',
  'trustpilot.com',
  'birdeye.com',
  'expertise.com',
  'threebestrated.com',
  'nextdoor.com',
  // Home-services and trades marketplaces
  'angi.com',
  'angieslist.com',
  'homeadvisor.com',
  'thumbtack.com',
  'houzz.com',
  'porch.com',
  'bark.com',
  'networx.com',
  'homeguide.com',
  'fixr.com',
  'taskrabbit.com',
  'buildzoom.com',
  'checkatrade.com',
  'trustatrader.com',
  'mybuilder.com',
  'ratedpeople.com',
  'homestars.com',
  // Social and community
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'quora.com',
  // Reference and video
  'wikipedia.org',
  'youtube.com',
  // Maps and listings run by the engines themselves
  'maps.google.com',
  'business.google.com',
  'bing.com',
  'maps.apple.com',
  'craigslist.org',
  // Marketplaces and listings outside the trades
  'foursquare.com',
  'clutch.co',
  'g2.com',
  'capterra.com',
  'glassdoor.com',
  'indeed.com',
  'zocdoc.com',
  'healthgrades.com',
  'avvo.com',
  'findlaw.com',
  'justia.com',
  'zillow.com',
  'realtor.com',
  'opentable.com',
  'amazon.com',
  'ebay.com',
  'etsy.com',
  'walmart.com',
  'fiverr.com',
  'upwork.com',
  'groupon.com',
  'medium.com',
  'wikihow.com',
];

const SET = new Set(DIRECTORY_DOMAINS);

/**
 * Whether a host or URL belongs to a directory, marketplace, social or
 * reference site. `m.yelp.com` and `www.yelp.com` match `yelp.com`.
 * @param hostOrUrl - A domain (`yelp.com`) or a full URL.
 */
export function isDirectoryDomain(hostOrUrl: string | null | undefined): boolean {
  if (!hostOrUrl) {
    return false;
  }
  let host = hostOrUrl.trim().toLowerCase();
  if (host.includes('/')) {
    try {
      host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
    } catch {
      return false;
    }
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (SET.has(labels.slice(i).join('.'))) {
      return true;
    }
  }
  return false;
}
