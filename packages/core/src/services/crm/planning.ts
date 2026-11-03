import type { ListField } from '@/libs/lists/spec';
import type { ListActor } from '@/services/lists/service';
import { stableCrmId } from '@/libs/crm/model';
import { createList, ListError, readList } from '@/services/lists/service';

const PLANS = [
  { key: 'outreach', title: 'GTM · Outreach plans', purpose: 'Local drafts and proposed times only. No send queue or automatic delivery.', extra: [{ key: 'recipient', label: 'Recipient email', type: 'text' }, { key: 'contact_url', label: 'CRM contact link', type: 'text' }, { key: 'reason', label: 'Why this touch', type: 'text' }] },
  { key: 'weekly', title: 'GTM · Weekly campaigns', purpose: 'Weekly email planning and copy. Dates are proposed dry-run slots, not provider schedules.', extra: [{ key: 'audience', label: 'Audience definition', type: 'text' }, { key: 'exclusions', label: 'Exclusions and suppressions', type: 'text' }, { key: 'preview', label: 'Preview text', type: 'text' }] },
] as const;

export async function installOutreachPlanning(actor: ListActor) {
  for (const plan of PLANS) {
    const id = stableCrmId(`gtm-plan-v1:${actor.orgId}:${plan.key}`);
    try {
      const existing = await readList(actor, { id, limit: 1 });
      if (existing.list.scope !== 'workspace') {
        throw new ListError('GTM planning List ID is already in use.', 409);
      }
      continue;
    } catch (error) {
      if (!(error instanceof ListError) || error.status !== 404) {
        throw error;
      }
    }
    const fields: ListField[] = [
      { key: 'name', label: 'Plan name', type: 'text' },
      ...plan.extra,
      { key: 'subject', label: 'Subject', type: 'text' },
      { key: 'body', label: 'Draft body', type: 'text' },
      { key: 'sender', label: 'Proposed sender', type: 'text' },
      { key: 'proposed_at', label: 'Proposed local date and time', type: 'text' },
      { key: 'timezone', label: 'Timezone', type: 'text' },
      { key: 'status', label: 'Planning status', type: 'select', options: ['Draft', 'Needs review', 'Planned · dry run', 'Cancelled'] },
      { key: 'reviewer', label: 'Reviewer', type: 'text' },
      { key: 'review_notes', label: 'Review notes', type: 'text' },
      { key: 'evidence', label: 'Source links and timing evidence', type: 'text' },
    ];
    await createList(actor, { id, title: plan.title, purpose: plan.purpose, scope: 'workspace', fields });
  }
}

export function planningListIds(orgId: string) {
  return PLANS.map(plan => stableCrmId(`gtm-plan-v1:${orgId}:${plan.key}`));
}
