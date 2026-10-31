import type { SeoRoadmap } from './roadmap';
import { WriteApiError } from '@/services/writeApi';

export function seoMeasurement(outcomes: SeoRoadmap['outcomes'] = []) {
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const rows = outcomes.map((o) => {
    const sourced = Boolean(o.source?.trim() && o.observedAt && Number.isFinite(Date.parse(o.observedAt)) && o.windowStart && o.windowEnd);
    const baselineSourced = Boolean(o.source?.trim() && o.baselineObservedAt && Number.isFinite(Date.parse(o.baselineObservedAt)) && o.baselineWindowStart && o.baselineWindowEnd);
    const baseline = baselineSourced ? finite(o.baseline) : null;
    const current = sourced ? finite(o.current) : null;
    return { ...o, baseline, current, target: finite(o.target), source: o.source ?? null, observedAt: o.observedAt ?? null, state: current !== null ? 'measured' as const : baseline !== null ? 'baseline_only' as const : 'unmeasured' as const };
  });
  return {
    outcomes: rows,
    measuredCount: rows.filter(o => o.state === 'measured').length,
    totalCount: rows.length,
    reportingNote: 'Published pages are delivery evidence. Search clicks and impressions are observed outcomes, not attributed leads or revenue. Missing sources and baselines stay unknown.',
  };
}

/**
 * Explicit person-triggered read from the selected property; only the strategy owner can save measurements.
 * @param orgId
 * @param projectId
 * @param userId
 * @param expectedRevision
 * @param now
 */
export async function captureSeoBaseline(orgId: string, projectId: number, userId: string, expectedRevision: number, now = new Date()) {
  const [{ getProject }, { readSeoRoadmap, updateSeoRoadmap }, { searchConsoleAccess }, { querySearchConsole, searchConsoleRange }] = await Promise.all([
    import('@/services/DataRoomService'),
    import('./roadmap'),
    import('./searchConsole'),
    import('@/libs/searchConsole/client'),
  ]);
  const project = await getProject(orgId, projectId);
  if (!project) {
    throw new WriteApiError(404, 'not_found', 'Client project not found in this workspace.');
  }
  const current = await readSeoRoadmap(orgId, projectId, userId);
  if (!current.canEdit || !current.strategy) {
    throw new WriteApiError(403, 'forbidden', 'Only the approved strategy owner can capture its baseline.');
  }
  if (current.roadmap.revision !== expectedRevision) {
    throw new WriteApiError(409, 'revision_conflict', 'The roadmap changed. Reload before capturing measurements.');
  }
  const siteUrl = project.meta.searchConsoleProperty?.siteUrl;
  if (!siteUrl) {
    throw new WriteApiError(422, 'missing_property', 'Select this client’s Search Console property before capturing a baseline.');
  }
  const source = `Google Search Console · ${siteUrl} · web search`;
  const ids = ['gsc_clicks', 'gsc_impressions'];
  if (current.roadmap.outcomes.some(o => ids.includes(o.id) && o.baseline !== undefined && o.source !== source)) {
    throw new WriteApiError(422, 'baseline_source_mismatch', 'The saved baseline uses a different source. Review and clear it explicitly before changing properties.');
  }
  const access = await searchConsoleAccess(orgId, projectId);
  if (!access.ok) {
    throw new WriteApiError(422, 'measurement_connection_unavailable', access.reason);
  }
  const range = searchConsoleRange({ days: 28 }, now);
  const report = await querySearchConsole(access.accessToken, { siteUrl, ...range, dimensions: [], rowLimit: 1 }).catch(() => {
    throw new WriteApiError(502, 'measurement_source_failed', 'Search Console could not be read. Check property access and retry; no measurements were saved.');
  });
  const row = report.rows[0];
  if (!row || ![row.clicks, row.impressions].every(v => Number.isFinite(v) && v >= 0)) {
    throw new WriteApiError(422, 'no_measurement_data', 'Search Console returned no usable aggregate data. No zero baseline was recorded.');
  }
  const observedAt = now.toISOString();
  const outcomes = [...current.roadmap.outcomes.filter(o => !ids.includes(o.id)), ...[
    { id: 'gsc_clicks', label: 'Organic search clicks', value: row.clicks, unit: 'clicks / 28 days' },
    { id: 'gsc_impressions', label: 'Organic search impressions', value: row.impressions, unit: 'impressions / 28 days' },
  ].map((metric) => {
    const old = current.roadmap.outcomes.find(o => o.id === metric.id);
    return {
      ...old,
      id: metric.id,
      label: metric.label,
      unit: metric.unit,
      baseline: old?.baseline ?? metric.value,
      baselineWindowStart: old?.baseline !== undefined ? old.baselineWindowStart : range.startDate,
      baselineWindowEnd: old?.baseline !== undefined ? old.baselineWindowEnd : range.endDate,
      baselineObservedAt: old?.baseline !== undefined ? old.baselineObservedAt : observedAt,
      current: metric.value,
      source,
      windowStart: range.startDate,
      windowEnd: range.endDate,
      observedAt,
    };
  })];
  const latestProject = await getProject(orgId, projectId);
  if (latestProject?.meta.searchConsoleProperty?.siteUrl !== siteUrl) {
    throw new WriteApiError(409, 'measurement_property_changed', 'The client’s Search Console property changed during capture. Reload and retry.');
  }
  return updateSeoRoadmap(orgId, projectId, userId, expectedRevision, { ...current.roadmap, outcomes });
}
