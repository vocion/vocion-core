import type { CadenceStanding } from './cadence';
import type { SeoRoadmap } from './roadmap';
import type { DataRoom } from '@/services/DataRoomService';
import { seoMeasurement } from './measurement';

export type SeoReadinessCheck = { id: string; label: string; state: 'ready' | 'missing' | 'unknown'; detail: string; href?: string };
export type SeoReadiness = { checks: SeoReadinessCheck[]; cadence: CadenceStanding | null; measurement: ReturnType<typeof seoMeasurement>; initiatives?: Array<{ label: string; status: string; blockedReason?: string; due?: string }>; publication?: { recordedPublished: number; verified: number; failed: number; unverified: number; notChecked: number }; goalHref?: string };

/**
 * Stored evidence only: a configured property or target does not prove working credentials.
 * @param project
 * @param outcomes
 * @param cadence
 */
export function seoReadiness(project: DataRoom, outcomes: SeoRoadmap['outcomes'], cadence: CadenceStanding | null): SeoReadiness {
  const m = project.meta;
  const base = `/dashboard/projects/${project.id}?app=seo`;
  const measurement = seoMeasurement(outcomes);
  const checks: SeoReadinessCheck[] = [
    { id: 'profile', label: 'Approved client profile', state: m.seoProfile?.clientType && m.seoProfile.goals?.length ? 'ready' : 'missing', detail: m.seoProfile ? 'Saved client profile; review audience and ranked goals before planning.' : 'Save the client profile; a prepared draft is not approval.', href: `${base}#seo-profile` },
    { id: 'inventory', label: 'Site evidence', state: m.siteInventory?.artifactId ? 'ready' : 'missing', detail: m.siteInventory ? `Inventory recorded ${m.siteInventory.readAt}; ${m.siteInventory.pages} pages read${m.siteInventory.cappedAt ? '; coverage was capped' : ''}. This is a dated snapshot, not continuous monitoring.` : 'Read the client site and save its inventory.', ...(m.siteInventory?.artifactId ? { href: `/dashboard/artifacts/${m.siteInventory.artifactId}?app=seo` } : {}) },
    { id: 'guidelines', label: 'Writing context', state: m.rules?.length || m.voice ? 'ready' : 'missing', detail: m.rules?.length || m.voice ? 'Rules or voice are recorded; inspect their evidence before using them.' : 'Record sourced voice and client rules.', href: `${base}#instructions` },
    { id: 'publishing', label: 'Publishing setup', state: m.publishTargets?.length ? 'ready' : 'missing', detail: m.publishTargets?.length ? 'A publishing target is configured. Connection and publication success are checked at execution.' : 'Choose a publishing target; planning can continue before publishing is connected.', href: `${base}#publishing` },
    { id: 'search_console', label: 'Search measurement source', state: m.searchConsoleProperty?.siteUrl ? 'ready' : 'missing', detail: m.searchConsoleProperty?.siteUrl ? `Selected property: ${m.searchConsoleProperty.siteUrl}. Access is verified when measurements are captured.` : 'Connect Search Console and select this client’s property. No traffic or rankings are inferred.', href: `${base}#connections` },
    { id: 'baseline', label: 'Outcome baseline', state: measurement.outcomes.some(o => o.baseline !== null) ? 'ready' : 'missing', detail: measurement.outcomes.some(o => o.baseline !== null) ? 'A sourced baseline is recorded; compare matching periods and definitions.' : 'Capture actual baseline values and dates before claiming improvement.' },
    { id: 'reporting', label: 'Outcome reporting', state: measurement.measuredCount ? 'ready' : 'unknown', detail: measurement.measuredCount ? `${measurement.measuredCount} of ${measurement.totalCount} outcomes have dated, sourced observations. Refresh before reporting; no automatic refresh is implied.` : 'No dated, sourced outcome observations. Delivery activity does not establish business impact.' },
  ];
  return { checks, cadence, measurement };
}

/**
 * Reads only records scoped to the current client and workspace; no external requests on page render.
 * @param orgId
 * @param projectId
 * @param now
 */
export async function readSeoReadiness(orgId: string, projectId: number, now = new Date()): Promise<SeoReadiness | null> {
  const [{ getProject }, { readSeoRoadmap }, { readCadenceStanding }, { listProjectSeoPages }, { publicationStanding }] = await Promise.all([
    import('@/services/DataRoomService'),
    import('./roadmap'),
    import('./cadence'),
    import('./records'),
    import('./publicationVerification'),
  ]);
  const project = await getProject(orgId, projectId);
  if (!project) {
    return null;
  }
  const [{ strategy, roadmap }, cadence, pages] = await Promise.all([readSeoRoadmap(orgId, projectId, ''), readCadenceStanding(orgId, projectId, now), listProjectSeoPages(orgId, projectId)]);
  const publication = publicationStanding(pages, now);
  return { ...seoReadiness(project, roadmap.outcomes, cadence), publication, initiatives: roadmap.initiatives.map(i => ({ label: i.label, status: i.status, blockedReason: i.blockedReason, due: i.due })), ...(strategy?.meta.goalId ? { goalHref: `/dashboard/goals/${strategy.meta.goalId}` } : {}) };
}

/**
 * Exportable status report: no model-generated impact or unsupported attribution.
 * @param title
 * @param readiness
 * @param now
 */
export function renderSeoMeasurementReport(title: string, readiness: SeoReadiness, now = new Date()): string {
  const out = [`# SEO progress · ${title}`, `As of ${now.toISOString()}`, '', '## Delivery', readiness.cadence?.line ?? 'No monthly delivery cadence configured.', '', '## Observed outcomes'];
  if (readiness.publication) {
    const p = readiness.publication;
    out.splice(5, 0, `${p.recordedPublished} provider-recorded published pages; ${p.verified} have matching public HTML checks, ${p.failed} failed checks, ${p.unverified} remain unverified, ${p.notChecked} have no current-URL check. Verification is dated evidence, not continuous monitoring or indexing proof.`);
  }
  for (const o of readiness.measurement.outcomes) {
    out.push(`- ${o.label}: ${o.current ?? 'Unknown'} ${o.unit}; baseline ${o.baseline ?? 'Unknown'}; baseline window ${o.baselineWindowStart ?? 'Unknown'} to ${o.baselineWindowEnd ?? 'Unknown'}; target ${o.target ?? 'Not set'}. Source: ${o.source ?? 'Not recorded'}. Window: ${o.windowStart ?? 'Unknown'} to ${o.windowEnd ?? 'Unknown'}. Observed: ${o.observedAt ?? 'Unknown'}.`);
  }
  if (!readiness.measurement.outcomes.length) {
    out.push('No outcome measures recorded.');
  }
  out.push('', '## Roadmap delivery', ...(readiness.initiatives?.length ? readiness.initiatives.map(i => `- ${i.label}: ${i.status}${i.due ? `; due ${i.due}` : ''}${i.blockedReason ? `; blocked: ${i.blockedReason}` : ''}`) : ['No executable initiatives recorded.']));
  if (readiness.goalHref) {
    out.push(`[Open the strategy goal and its review](${readiness.goalHref})`);
  }
  out.push('', readiness.measurement.reportingNote, '', '## Readiness and next actions', ...readiness.checks.map(c => `- ${c.label} (${c.state}): ${c.detail}${c.href ? ` [Open evidence](${c.href})` : ''}`));
  return out.join('\n');
}
