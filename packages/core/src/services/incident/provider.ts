/**
 * THE INCIDENT FAMILY — an on-call pager, named for its constructs.
 *
 * An incident is something firing on a service, with an urgency, the people
 * it is assigned to, a status (triggered, acknowledged, resolved) and a
 * timeline. PagerDuty is the first provider; Opsgenie or incident.io would be
 * the next behind the same interface. An agent's tools are `incident_list`
 * and `incident_read`; its one write is the `incident.acknowledge` action.
 * Nothing it is told names the vendor.
 */

import type { FamilySource } from '@/libs/connectors/families';
import { FAMILY_LABEL, familySourcesForOrg } from '@/libs/connectors/families';
import { credentialsForSource, pickFamilySource } from '@/services/connectors/sourceCredentials';

export type IncidentRow = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  urgency: string | null;
  service: string | null;
  assignees: string[];
  created: string | null;
  url: string;
};

export type Incident = IncidentRow & {
  description: string | null;
  priority: string | null;
  escalationPolicy: string | null;
  lastStatusChange: string | null;
  acknowledgedBy: string[];
  alertCount: number | null;
  /** What happened, newest first: triggered, notified, acknowledged, escalated, resolved. */
  timeline: Array<{ at: string | null; type: string; summary: string }>;
  notes: Array<{ at: string | null; author: string | null; body: string }>;
};

export type IncidentProvider = {
  kind: string;
  label: string;
  sourceSlug: string;
  listIncidents: (opts: { statuses?: string[]; service?: string | null; since?: string | null; until?: string | null; limit: number }) => Promise<IncidentRow[]>;
  readIncident: (id: string) => Promise<Incident>;
  /** Acknowledge an incident; `from` is the status it had. */
  acknowledge: (id: string) => Promise<{ from: string; to: string; url: string }>;
};

/**
 * The provider for the workspace's pager: the named source, else its one
 * incident source.
 * @param orgId - The workspace.
 * @param opts - What to resolve by.
 * @param opts.sourceSlug - A source slug, when the workspace has more than one.
 * @param opts.slugs - Only these sources: an agent's own.
 */
export async function incidentProviderFor(orgId: string, opts: { sourceSlug?: string | null; slugs?: readonly string[] } = {}): Promise<IncidentProvider> {
  const source = pickFamilySource(await familySourcesForOrg(orgId, 'incident', opts.slugs), FAMILY_LABEL.incident, opts.sourceSlug);
  return providerFor(orgId, source);
}

async function providerFor(orgId: string, source: FamilySource): Promise<IncidentProvider> {
  const credentials = await credentialsForSource(orgId, source);
  if (source.kind === 'pagerduty') {
    const { pagerdutyIncidentProvider } = await import('./providers/pagerduty');
    return pagerdutyIncidentProvider(source, credentials);
  }
  throw new Error(`${source.slug} is a ${source.kind} source, which no incident provider serves yet.`);
}
