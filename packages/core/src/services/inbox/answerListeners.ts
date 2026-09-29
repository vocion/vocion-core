import type { AnswerSubscriber, DecidedAskRow } from './askDecided';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { automationSchema, workflowSchema } from '@/models/Schema';
import { listenersFor } from './askDecided';

/** The open-ask fields a preview needs: the payload's scalars and the options on offer. */
export type PreviewAsk = Omit<DecidedAskRow, 'status' | 'decision' | 'followUp' | 'decidedBy' | 'decidedAt'> & { options: Array<{ id: string }> };

/**
 * What each answer on these asks would start, read once for the page. That
 * means the org's active, unpaused automations on `ask.decided` and the legacy
 * event-triggered workflows, matched the way `emitEvent` will match them
 * (`askDecided.listenersFor`). Keyed by ask id, then decision id.
 * @param orgId - Tenant.
 * @param asks - The open asks on the page.
 */
export async function loadAnswerListeners(orgId: string, asks: PreviewAsk[]): Promise<Map<number, Record<string, string[]>>> {
  const out = new Map<number, Record<string, string[]>>();
  if (asks.length === 0) {
    return out;
  }
  const [automations, workflows] = await Promise.all([
    db
      .select({ name: automationSchema.name, status: automationSchema.status, pausedAt: automationSchema.pausedAt, whenConfig: automationSchema.whenConfig })
      .from(automationSchema)
      .where(eq(automationSchema.orgId, orgId)),
    db
      .select({ slug: workflowSchema.slug, status: workflowSchema.status, trigger: workflowSchema.trigger })
      .from(workflowSchema)
      .where(eq(workflowSchema.orgId, orgId)),
  ]);
  const subscribers: AnswerSubscriber[] = [
    ...automations
      .filter(a => a.status === 'active' && !a.pausedAt)
      .map(a => ({ name: a.name, event: a.whenConfig.event, filter: a.whenConfig.filter })),
    ...workflows
      .filter(w => w.status === 'active' && w.trigger.type === 'event')
      .map(w => ({ name: w.slug, event: w.trigger.event as string | undefined, filter: w.trigger.filter })),
  ];
  for (const ask of asks) {
    const decisions = ['approve', 'reject', 'done', 'other', ...ask.options.map(o => o.id)];
    out.set(ask.id, listenersFor(ask, decisions, subscribers));
  }
  return out;
}
