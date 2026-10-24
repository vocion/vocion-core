/**
 * Google Ads connector — ingest campaign performance as retrievable documents.
 *
 * Auth: a Google login with the `adwords` scope, or a pasted OAuth client and
 * refresh token, through `resolveGoogleAccessToken`. Developer tokens were
 * retired on 2026-09-09 (access follows the Google Cloud project that owns the
 * OAuth client), so `developerToken` is optional and only sent when a
 * credential still carries one. Incremental: when `ctx.since` is set the GAQL
 * `WHERE segments.date >= <since>`; otherwise the last 30 days. Paginates the
 * `nextPageToken`. One IngestDoc per campaign/day row.
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { adsSearch, GOOGLE_ADS_API_VERSION, GOOGLE_ADS_BASE } from '@/libs/googleAds/client';
import { resolveGoogleAccessToken } from './googleAuth';

export const googleAdsConfigSchema = z.object({
  customerId: z.string().min(1),
  /** Manager (MCC) account id, when the login reaches the account through one. */
  loginCustomerId: z.string().optional(),
  baseUrl: z.string().url().default(`${GOOGLE_ADS_BASE}/${GOOGLE_ADS_API_VERSION}`),
});

const SELECT = 'campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, segments.date';

type AdsRow = {
  campaign?: { id?: string; name?: string; status?: string };
  metrics?: Record<string, string | number>;
  segments?: { date?: string };
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const googleAdsConnector: SourceConnector<typeof googleAdsConfigSchema> = {
  slug: 'google-ads',
  name: 'Google Ads',
  description: 'Campaign performance from Google Ads. Impressions, clicks, cost and conversions by day.',
  icon: 'Megaphone',
  category: 'sales-marketing',
  brand: 'googleads',
  authKind: 'oauth',
  configSchema: googleAdsConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = googleAdsConfigSchema.parse(ctx.config);
    const accessToken = await resolveGoogleAccessToken(ctx.credentials, ctx.orgId);
    const developerToken = typeof ctx.credentials?.developerToken === 'string' ? ctx.credentials.developerToken : null;
    const dateClause = ctx.since
      ? `segments.date >= '${isoDate(ctx.since)}'`
      : 'segments.date DURING LAST_30_DAYS';
    const rows = await adsSearch<AdsRow>({ accessToken, customerId: cfg.customerId, loginCustomerId: cfg.loginCustomerId, developerToken, baseUrl: cfg.baseUrl }, `SELECT ${SELECT} FROM campaign WHERE ${dateClause}`);
    for (const row of rows) {
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
  },
};
