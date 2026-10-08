/**
 * `incident.acknowledge` — someone is on it: acknowledge a triggered incident
 * on the connected on-call pager, which stops its escalation.
 *
 * No Undo, and the description says so: PagerDuty does not move an incident
 * back to triggered. With no Undo it waits for a person by the ladder's
 * default, and a person who asks for it in their own words runs it as theirs.
 * An incident already acknowledged or resolved is answered as it stands, with
 * nothing written.
 *
 * The acknowledgement is recorded as the PagerDuty user the credential names
 * (`fromEmail`); without one the run fails with the sentence that names the
 * fix, and nothing is written.
 */

import type { Action } from './types';
import { z } from 'zod';

export const ACKNOWLEDGE_INCIDENT_ACTION_ID = 'incident.acknowledge';

const acknowledgeInput = z.object({
  incidentId: z.string().min(1).max(40).describe('The incident id, as incident_list or incident_read returned it.'),
  source: z.string().max(80).optional().describe('The pager source, when the workspace has more than one.'),
});

type Input = z.infer<typeof acknowledgeInput>;

export const incidentAcknowledgeAction: Action<typeof acknowledgeInput> = {
  id: ACKNOWLEDGE_INCIDENT_ACTION_ID,
  name: 'Acknowledge an incident',
  description: 'Acknowledge a triggered incident on the connected on-call pager (PagerDuty), which stops its escalation; recorded as the PagerDuty user the credential names. No Undo: PagerDuty does not move an incident back to triggered.',
  inputSchema: acknowledgeInput,
  grant: 'respond_incident',
  external: true,
  dedupKeyFor: input => `${ACKNOWLEDGE_INCIDENT_ACTION_ID}:${input.incidentId.trim()}`,
  ownsDedupKey: true,
  async precheck(ctx, input) {
    try {
      const { incidentProviderFor } = await import('@/services/incident/provider');
      await incidentProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
      return undefined;
    } catch (err) {
      return (err as Error).message;
    }
  },
  async reviewCard(_ctx, raw) {
    const input = raw as Input;
    return {
      title: `Acknowledge incident ${input.incidentId}`,
      system: 'On-call pager',
      headline: 'Acknowledge this incident now, which stops its escalation.',
      badges: [{ label: 'On-call pager' }, { label: 'No Undo', tone: 'warn' }],
      fields: [{ label: 'Incident', value: input.incidentId }, ...(input.source ? [{ label: 'Source', value: input.source }] : [])],
      nextAction: 'Approving acknowledges it on the pager now.',
      verbs: { approve: 'Acknowledge', reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const { incidentProviderFor } = await import('@/services/incident/provider');
    const provider = await incidentProviderFor(ctx.orgId, { sourceSlug: input.source ?? null });
    const id = input.incidentId.trim();
    const out = await provider.acknowledge(id);
    const line = out.from === out.to
      ? `Incident ${id} was already ${out.to}; nothing was changed.`
      : `Acknowledged incident ${id} on ${provider.label} (${out.from} → ${out.to}).`;
    return { acknowledged: out.to === 'acknowledged', incidentId: id, from: out.from, to: out.to, url: out.url, pager: provider.label, line };
  },
};
