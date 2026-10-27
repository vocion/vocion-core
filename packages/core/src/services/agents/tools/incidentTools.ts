/**
 * The incident family's reads — the connected on-call pager, live
 * (`services/incident/provider.ts`).
 *
 *   incident_list  incidents by status, service and time, newest first
 *   incident_read  one incident: service, urgency, priority, who is on it,
 *                  who acknowledged, the timeline and the notes
 *
 * Present for any agent whose `connectorSources` include an incident source.
 * The write — acknowledging, which stops the escalation — is the
 * `incident.acknowledge` action through `propose_action`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { familyInScope, familySourceSlugs } from '@/libs/connectors/families';

export const LIST_INCIDENTS_TOOL = 'incident_list';
export const READ_INCIDENT_TOOL = 'incident_read';

export function incidentTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!familyInScope(ctx, 'incident')) {
    return [];
  }
  return [listTool(ctx), readTool(ctx)];
}

async function providerFor(ctx: RuntimeContext, source: string | undefined) {
  const { incidentProviderFor } = await import('@/services/incident/provider');
  return incidentProviderFor(ctx.orgId, { sourceSlug: source ?? null, slugs: familySourceSlugs(ctx, 'incident') });
}

function listTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const statuses = args.statuses ?? ['triggered', 'acknowledged'];
        const incidents = await provider.listIncidents({ statuses, service: args.service ?? null, since: args.since ?? null, until: args.until ?? null, limit: args.limit ?? 20 });
        return JSON.stringify({ ok: true, pager: provider.label, statuses, count: incidents.length, incidents, note: incidents.length === 0 ? 'Nothing matched.' : `Read one whole with ${READ_INCIDENT_TOOL}; acknowledge a triggered one with propose_action incident.acknowledge.` });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: LIST_INCIDENTS_TOOL,
      description: 'Incidents on the connected on-call pager (PagerDuty), read live, newest first: id, number, title, status, urgency, service, who it is assigned to, when it started, and the link. Defaults to what is open now (triggered and acknowledged); name resolved, a service id or a time window to look back.',
      schema: z.object({
        statuses: z.array(z.enum(['triggered', 'acknowledged', 'resolved'])).optional().describe('Which statuses (default triggered and acknowledged).'),
        service: z.string().max(40).optional().describe('One service, by its id.'),
        since: z.string().optional().describe('Start of the window, an ISO time.'),
        until: z.string().optional().describe('End of the window, an ISO time.'),
        limit: z.number().int().min(1).max(100).optional().describe('How many (default 20).'),
        source: z.string().optional().describe('The pager source, when the workspace has more than one.'),
      }),
    },
  );
}

function readTool(ctx: RuntimeContext): StructuredToolInterface {
  return tool(
    async (args) => {
      try {
        const provider = await providerFor(ctx, args.source);
        const incident = await provider.readIncident(args.id);
        return JSON.stringify({ ok: true, pager: provider.label, incident, note: incident.status === 'triggered' ? 'Triggered and unacknowledged: propose_action incident.acknowledge with this id stops the escalation.' : undefined });
      } catch (err) {
        return JSON.stringify({ ok: false, error: (err as Error).message });
      }
    },
    {
      name: READ_INCIDENT_TOOL,
      description: 'One incident on the connected on-call pager (PagerDuty), read live: title, description, status, urgency, priority, service, escalation policy, who it is assigned to and who acknowledged it, how many alerts it grouped, its timeline (triggered, notified, acknowledged, escalated, resolved) and its notes. Read it before saying what is happening or acknowledging.',
      schema: z.object({
        id: z.string().min(1).max(40).describe('The incident id (PT4KHLK), as incident_list returned it.'),
        source: z.string().optional().describe('The pager source, when the workspace has more than one.'),
      }),
    },
  );
}
