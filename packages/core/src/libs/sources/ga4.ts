/**
 * GA4 (Google Analytics Data API) connector — ingest analytics/CRO rows as
 * retrievable documents. The CRO half of the Daylyte reporting deployment.
 *
 * Auth: OAuth access token in `ctx.credentials.token`. Incremental: when
 * `ctx.since` is set the report's `startDate` is that day; otherwise 30 days
 * back. One IngestDoc per report row. (GA4 runReport is offset/limit, not
 * cursor-paginated; we pull a single capped report — enough for daily syncs.)
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';

const ga4ConfigSchema = z.object({
  propertyId: z.string().min(1),
  dimensions: z.array(z.string()).default(['date', 'landingPagePlusQueryString']),
  metrics: z.array(z.string()).default(['sessions', 'conversions', 'bounceRate']),
  limit: z.number().int().min(1).max(100000).default(10000),
  baseUrl: z.string().url().default('https://analyticsdata.googleapis.com/v1beta'),
});

type Ga4Row = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };
type Ga4Report = { rows?: Ga4Row[] };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const ga4Connector: SourceConnector<typeof ga4ConfigSchema> = {
  slug: 'ga4',
  name: 'Google Analytics 4',
  description: 'Ingest GA4 report rows (sessions, conversions, bounce rate) by date + landing page.',
  icon: 'BarChart3',
  authKind: 'oauth',
  configSchema: ga4ConfigSchema,
  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = ga4ConfigSchema.parse(ctx.config);
    const token = ctx.credentials?.token as string | undefined;
    if (!token) {
      throw new Error('GA4 connector requires credentials.token');
    }
    const startDate = ctx.since ? isoDate(ctx.since) : '30daysAgo';
    const res = await fetch(`${cfg.baseUrl}/properties/${cfg.propertyId}:runReport`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: cfg.dimensions.map(name => ({ name })),
        metrics: cfg.metrics.map(name => ({ name })),
        limit: cfg.limit,
      }),
    });
    if (!res.ok) {
      throw new Error(`GA4 runReport failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const report = (await res.json()) as Ga4Report;
    for (const row of report.rows ?? []) {
      const dims = (row.dimensionValues ?? []).map(d => d.value ?? '');
      const key = dims.join('|') || 'row';
      const content = [
        ...cfg.dimensions.map((name, i) => `${name}: ${dims[i] ?? ''}`),
        ...cfg.metrics.map((name, i) => `${name}: ${row.metricValues?.[i]?.value ?? ''}`),
      ].join('\n');
      ctx.onProgress?.({ kind: 'fetched', uri: key });
      yield {
        externalId: `ga4:${key}`,
        title: `GA4 ${dims.join(' · ')}`.trim(),
        content,
        metadata: { kind: 'ga4-row', dimensions: dims },
      };
    }
  },
};
