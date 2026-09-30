import type { NotificationRuleConfig } from '@/libs/notifications/types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { argAsText, renderString } from '@/libs/rest/template';
import { notificationRuleSchema, projectSchema } from '@/models/Schema';
import { matchesFilter } from '@/services/eventFilter';
import { notify } from './notify';
import { resolveRecipients } from './people';

/**
 * THE EVENT BUS SIDE OF NOTIFICATIONS (backlog 048). `emitEvent` calls
 * {@link notifyFromEvent} for every event it records; a stored rule
 * (`notification_rule`, declared in a plugin or the workspace) whose event and
 * filter match turns it into one `notify()`. An event no rule names notifies
 * nobody — that is the whole of the noise policy.
 *
 * Nothing here reads meaning from words: the rule names a typed event, its
 * filter compares payload scalars with `===` (the automation rule), and the
 * templates only place payload fields into the rule's own sentences.
 */

/**
 * Render one `{field}` template over the payload, as text. A template whose
 * every field is absent renders null.
 * @param template - The rule's template.
 * @param payload - The event's payload.
 */
export function renderText(template: string | undefined, payload: Record<string, unknown>): string | null {
  if (!template) {
    return null;
  }
  const out = renderString(template, payload);
  if (out === undefined || out === null) {
    return null;
  }
  const text = (typeof out === 'string' ? out : argAsText(out)).trim();
  return text === '' ? null : text;
}

export type RenderedNotification = {
  title: string;
  body: string | null;
  record: { type: string; id: string } | null;
  /** App path before the workspace prefix, or null to open the record's page. */
  path: string | null;
  dedupeKey: string;
};

/**
 * What one rule makes of one event. Pure.
 * @param rule - The rule's config.
 * @param payload - The event's payload.
 * @param eventRef - The event's id or dedupe key, the dedupe of last resort.
 */
export function renderNotification(rule: NotificationRuleConfig, payload: Record<string, unknown>, eventRef: string): RenderedNotification {
  const recordType = rule.record ? renderText(rule.record.type, payload) : null;
  const recordId = rule.record ? renderText(rule.record.id, payload) : null;
  const record = recordType && recordId ? { type: recordType, id: recordId } : null;
  const dedupe = renderText(rule.dedupe, payload) ?? (record ? `${record.type}:${record.id}` : `event:${eventRef}`);
  return {
    title: renderText(rule.title, payload) ?? rule.label,
    body: renderText(rule.body, payload),
    record,
    path: renderText(rule.link, payload),
    dedupeKey: `${rule.kind}:${dedupe}`,
  };
}

export type NotifyFromEventResult = { rules: number; notified: number; deduped: number };

/**
 * Match an event against this workspace's declared notification kinds and
 * notify for each that matches. Never throws: a notification that could not
 * be written must not undo the event that raised it; the failure is written
 * on the rule (`lastNote`) and logged.
 * @param input - The event.
 * @param input.orgId - Tenant.
 * @param input.type - Event type.
 * @param input.payload - Its payload.
 * @param input.eventId - The `event_log` row.
 * @param input.dedupeKey - The event's own dedupe key.
 */
export async function notifyFromEvent(input: { orgId: string; type: string; payload: Record<string, unknown>; eventId: number | null; dedupeKey?: string | null }): Promise<NotifyFromEventResult> {
  const result: NotifyFromEventResult = { rules: 0, notified: 0, deduped: 0 };
  let rules: Array<typeof notificationRuleSchema.$inferSelect>;
  try {
    rules = await db
      .select()
      .from(notificationRuleSchema)
      .where(and(eq(notificationRuleSchema.orgId, input.orgId), eq(notificationRuleSchema.event, input.type), eq(notificationRuleSchema.status, 'active')));
  } catch (err) {
    console.warn('[notifications] could not read notification rules', { orgId: input.orgId, event: input.type, error: (err as Error).message });
    return result;
  }
  const matching = rules.filter(r => matchesFilter(input.payload, r.config.filter));
  if (matching.length === 0) {
    return result;
  }
  const [project] = await db.select({ slug: projectSchema.slug }).from(projectSchema).where(eq(projectSchema.id, input.orgId)).limit(1);
  for (const rule of matching) {
    result.rules += 1;
    let note: string;
    try {
      const rendered = renderNotification(rule.config, input.payload, String(input.eventId ?? input.dedupeKey ?? Date.now()));
      const link = await linkFor(input.orgId, project?.slug ?? null, rendered);
      const recipients = await resolveRecipients(input.orgId, rule.config.who, input.payload);
      const out = await notify({
        orgId: input.orgId,
        kind: rule.kind,
        userIds: recipients.userIds,
        title: rendered.title,
        body: rendered.body,
        link,
        record: rendered.record,
        dedupeKey: rendered.dedupeKey,
        eventType: input.type,
        eventId: input.eventId,
      });
      result.notified += out.created.length;
      result.deduped += out.deduped;
      const reached = recipients.userIds.length === 0
        ? 'reached nobody'
        : out.created.length > 0
          ? `notified ${out.created.length} ${out.created.length === 1 ? 'person' : 'people'}`
          : 'raised again for a record already notified — nobody was notified twice';
      note = [reached, recipients.note].filter(Boolean).join(' — ');
    } catch (err) {
      note = `could not notify: ${(err as Error).message}`.slice(0, 500);
      console.warn('[notifications] a rule matched and could not notify', { orgId: input.orgId, kind: rule.kind, event: input.type, error: (err as Error).message });
    }
    await db.update(notificationRuleSchema).set({ lastFiredAt: new Date(), lastNote: note }).where(eq(notificationRuleSchema.id, rule.id)).catch(() => {});
  }
  return result;
}

/**
 * Where the notification opens: the rule's own app path in this workspace,
 * or the record's page (the one link every surface uses for a record).
 * @param orgId - Tenant.
 * @param slug - The workspace slug.
 * @param rendered - The rendered notification.
 */
async function linkFor(orgId: string, slug: string | null, rendered: RenderedNotification): Promise<string | null> {
  if (rendered.path) {
    return slug ? workspaceUrl(slug, rendered.path) : rendered.path;
  }
  if (rendered.record) {
    const { recordHref } = await import('@/services/objects/recordHref');
    return recordHref(orgId, { objectType: rendered.record.type, id: rendered.record.id }).catch(() => null);
  }
  return null;
}
