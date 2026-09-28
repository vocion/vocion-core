/**
 * Google Ads connector — ingest campaign performance as retrievable documents.
 * The marquee integration for the Daylyte PPC reporting deployment.
 *
 * Auth: the workspace's Google credential — a refresh token plus the OAuth
 * client pair, exchanged for an access token by `resolveGoogleAccessToken`, or
 * a short-lived `credentials.token` as the legacy stopgap — and a
 * `developerToken` (Google Ads API requires both). Incremental: when `ctx.since` is set the GAQL
 * `WHERE segments.date >= <since>`; otherwise the last 30 days. Paginates the
 * `nextPageToken`. One IngestDoc per campaign/day row.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { resolveGoogleAccessToken } from './googleAuth';

const googleAdsConfigSchema = z.object({
  customerId: z.string().min(1),
  /** Manager (MCC) account id, when the token authenticates through one. */
  loginCustomerId: z.string().optional(),
  baseUrl: z.string().url().default('https://googleads.googleapis.com/v17'),
});

const SELECT = 'campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, segments.date';

type AdsRow = {
  campaign?: { id?: string; name?: string; status?: string };
  metrics?: Record<string, string | number>;
  segments?: { date?: string };
};
type AdsPage = { results?: AdsRow[]; nextPageToken?: string };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const googleAdsConnector: SourceConnector<typeof googleAdsConfigSchema> = {
  slug: 'google-ads',
  name: 'Google Ads',
  description: 'Ingest Google Ads campaign performance (impressions, clicks, cost, conversions) by day.',
  icon: 'Megaphone',
  authKind: 'oauth',
  configSchema: googleAdsConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = googleAdsConfigSchema.parse(ctx.config);
    const developerToken = ctx.credentials?.developerToken as string | undefined;
    if (!developerToken) {
      throw new Error('Google Ads connector requires credentials.developerToken — add the developer token to the Google credential');
    }
    // The Google credential the Sources screen saves holds a refresh token and
    // no access token, so reading `credentials.token` directly failed every
    // sync, and a pasted access token died within the hour (vocion-core#129).
    // Resolved once per sync; the helper caches it until five minutes before
    // it expires, well past the length of one sync.
    const token = await resolveGoogleAccessToken(ctx.credentials);
    const dateClause = ctx.since
      ? `segments.date >= '${isoDate(ctx.since)}'`
      : 'segments.date DURING LAST_30_DAYS';
    const query = `SELECT ${SELECT} FROM campaign WHERE ${dateClause}`;
    const headers: Record<string, string> = {
      'authorization': `Bearer ${token}`,
      'developer-token': developerToken,
      'content-type': 'application/json',
    };
    if (cfg.loginCustomerId) {
      headers['login-customer-id'] = cfg.loginCustomerId;
    }

    let pageToken = ctx.cursor ?? undefined;
    do {
      const res = await fetch(`${cfg.baseUrl}/customers/${cfg.customerId}/googleAds:search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      });
      if (!res.ok) {
        throw new Error(`Google Ads search failed: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const page = (await res.json()) as AdsPage;
      for (const row of page.results ?? []) {
        const date = row.segments?.date ?? '';
        const campaignId = row.campaign?.id ?? 'unknown';
        const content = [
          `campaign: ${row.campaign?.name ?? campaignId}`,
          `date: ${date}`,
          ...Object.entries(row.metrics ?? {}).map(([k, v]) => `${k}: ${v}`),
        ].join('\n');
        ctx.onProgress?.({ kind: 'fetched', uri: `${campaignId}:${date}` });
        yield {
          externalId: `campaign:${campaignId}:${date}`,
          title: `${row.campaign?.name ?? campaignId} — ${date}`,
          content,
          lastModifiedAt: date ? new Date(date) : null,
          metadata: { campaignId, date, kind: 'google-ads-campaign-day' },
        };
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  },
};
