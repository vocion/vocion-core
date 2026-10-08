/**
 * PAGERDUTY — the first incident provider (`../provider.ts`), on the client
 * and credential the `pagerduty` source carries (`libs/sources/pagerduty.ts`).
 *
 * Acknowledging is `PUT /incidents/{id}` with status `acknowledged`, made as
 * the PagerDuty user the credential names (`From`). PagerDuty cannot move an
 * incident back to triggered, so the acknowledgement has no Undo; it does
 * stop the escalation, which is why it is worth doing from Vocion at all.
 */

import type { Incident, IncidentProvider, IncidentRow } from '../provider';
import type { FamilySource } from '@/libs/connectors/families';
import { orThrow } from '@/libs/connectors/vendorRequest';
import { pagerdutyAccessFrom, pagerdutyApi } from '@/libs/sources/pagerduty';

type Ref = { id?: string; summary?: string | null } | null | undefined;
type PdIncident = {
  id: string;
  incident_number?: number | null;
  title?: string | null;
  description?: string | null;
  status: string;
  urgency?: string | null;
  created_at?: string | null;
  last_status_change_at?: string | null;
  html_url: string;
  service?: Ref;
  priority?: Ref;
  escalation_policy?: Ref;
  assignments?: Array<{ assignee?: Ref }> | null;
  acknowledgements?: Array<{ acknowledger?: Ref }> | null;
};

function row(i: PdIncident): IncidentRow {
  return {
    id: i.id,
    number: i.incident_number ?? null,
    title: i.title ?? '',
    status: i.status,
    urgency: i.urgency ?? null,
    service: i.service?.summary ?? null,
    assignees: (i.assignments ?? []).map(x => x.assignee?.summary ?? '').filter(Boolean),
    created: i.created_at ?? null,
    url: i.html_url,
  };
}

/**
 * The provider for one PagerDuty source.
 * @param source - The `pagerduty` source row.
 * @param credentials - Its decrypted credential.
 */
export function pagerdutyIncidentProvider(source: FamilySource, credentials: Record<string, unknown> | undefined): IncidentProvider {
  const parsed = pagerdutyAccessFrom(credentials, source.config.region);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  const a = parsed.access;

  return {
    kind: 'pagerduty',
    label: 'PagerDuty',
    sourceSlug: source.slug,

    async listIncidents(opts) {
      const params = new URLSearchParams({ limit: String(Math.min(opts.limit, 100)), sort_by: 'created_at:desc' });
      for (const status of opts.statuses ?? []) {
        params.append('statuses[]', status);
      }
      if (opts.service) {
        params.append('service_ids[]', opts.service);
      }
      if (opts.since) {
        params.set('since', opts.since);
      }
      if (opts.until) {
        params.set('until', opts.until);
      }
      const page = orThrow(await pagerdutyApi<{ incidents?: PdIncident[] }>(a, `/incidents?${params.toString()}`));
      return (page.incidents ?? []).map(row);
    },

    async readIncident(id) {
      const path = `/incidents/${encodeURIComponent(id.trim())}`;
      const { incident } = orThrow(await pagerdutyApi<{ incident: PdIncident }>(a, path));
      const [log, notes, alerts] = await Promise.all([
        pagerdutyApi<{ log_entries?: Array<{ created_at?: string; type?: string; summary?: string }> }>(a, `${path}/log_entries?limit=25`),
        pagerdutyApi<{ notes?: Array<{ created_at?: string; user?: Ref; content?: string }> }>(a, `${path}/notes`),
        pagerdutyApi<{ total?: number | null }>(a, `${path}/alerts?limit=1&total=true`),
      ]);
      const out: Incident = {
        ...row(incident),
        description: incident.description ?? null,
        priority: incident.priority?.summary ?? null,
        escalationPolicy: incident.escalation_policy?.summary ?? null,
        lastStatusChange: incident.last_status_change_at ?? null,
        acknowledgedBy: (incident.acknowledgements ?? []).map(x => x.acknowledger?.summary ?? '').filter(Boolean),
        alertCount: alerts.ok ? alerts.data.total ?? null : null,
        timeline: log.ok ? (log.data.log_entries ?? []).map(e => ({ at: e.created_at ?? null, type: (e.type ?? '').replace(/_log_entry$/, ''), summary: e.summary ?? '' })) : [],
        notes: notes.ok ? (notes.data.notes ?? []).map(n => ({ at: n.created_at ?? null, author: n.user?.summary ?? null, body: n.content ?? '' })) : [],
      };
      return out;
    },

    async acknowledge(id) {
      if (!a.fromEmail) {
        throw new Error('PagerDuty records every acknowledgement as a user, and the stored credential names none. Add the email of a PagerDuty user to the PagerDuty credential on the Connectors page.');
      }
      const path = `/incidents/${encodeURIComponent(id.trim())}`;
      const before = orThrow(await pagerdutyApi<{ incident: PdIncident }>(a, path)).incident;
      if (before.status !== 'triggered') {
        return { from: before.status, to: before.status, url: before.html_url };
      }
      const after = orThrow(await pagerdutyApi<{ incident: PdIncident }>(a, path, { method: 'PUT', json: { incident: { type: 'incident_reference', status: 'acknowledged' } } })).incident;
      return { from: before.status, to: after.status, url: after.html_url };
    },
  };
}
