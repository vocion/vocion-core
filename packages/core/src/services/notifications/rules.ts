import type { NotificationRuleConfig } from '@/libs/notifications/types';
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { argAsText, renderString } from '@/libs/rest/template';
import { notificationRuleSchema, projectSchema } from '@/models/Schema';
import { codeForRecord } from '@/services/codes';
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

/**
 * THE KINDS CORE DECLARES ITSELF — moments core owns, which no plugin or
 * workspace would know to declare, and which must reach a person whatever was
 * declared. Same shape as a declared kind and matched the same way; a stored
 * rule with the same `kind` replaces it (a workspace entry with
 * `status: disabled` turns it off), and each person picks its channels in
 * notification settings like any other kind.
 *
 *   decision-escalated — a decision waiting on Needs you is near its
 *   deadline, past it and held, or was applied by default
 *   (`services/needsYou/DecisionClockService.ts`). One per person per sweep.
 *
 *   sign-in-method-added — Google, Microsoft or another provider was linked
 *   to the person's login, at sign-in or from their profile
 *   (`services/auth/signInMethods.ts`). The person hears it so a link they
 *   did not make is noticed; it opens their profile, where it can be removed.
 *
 *   org-joined — the person joined an Org without opening an invite link: an
 *   invite accepted at sign-in, or an auto-join domain
 *   (`services/auth/joinInvites.ts`). Lands in that Org's workspace and names
 *   the workspaces they now open there.
 *
 *   org-invited — another Org invited the address of a login that already
 *   exists (`tellInvitee`). Opens their profile, where the invite has a Join
 *   button; their next sign-in joins it anyway.
 */
export const CORE_NOTIFICATION_RULES: readonly NotificationRuleConfig[] = [
  {
    kind: 'decision-escalated',
    label: 'Decisions due',
    description: 'A decision waiting on you is near its deadline, past it, or was applied by default.',
    event: 'decision.escalated',
    who: { field: 'ownerUserId' },
    title: '{title}',
    body: '{body}',
    link: '{link}',
    dedupe: '{dedupe}',
  },
  {
    kind: 'sign-in-method-added',
    label: 'Sign-in methods',
    description: 'A way to sign in, such as Google or Microsoft, was added to your login.',
    event: 'account.sign_in_method_added',
    who: { field: 'userId' },
    title: '{title}',
    body: '{body}',
    link: '{link}',
    dedupe: '{dedupe}',
  },
  {
    kind: 'org-invited',
    label: 'Invitations',
    description: 'Another Org invited you to join it.',
    event: 'account.org_invited',
    who: { field: 'userId' },
    title: '{title}',
    body: '{body}',
    link: '{link}',
    dedupe: '{dedupe}',
  },
  {
    kind: 'org-joined',
    label: 'Orgs joined',
    description: 'You joined an Org: an invite to your address was accepted when you signed in.',
    event: 'account.org_joined',
    who: { field: 'userId' },
    title: '{title}',
    body: '{body}',
    link: '{link}',
    dedupe: '{dedupe}',
  },
];

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
  const core = CORE_NOTIFICATION_RULES.filter(r => r.event === input.type);
  let rules: Array<{ id: number | null; kind: string; config: NotificationRuleConfig }>;
  try {
    const stored = await db
      .select()
      .from(notificationRuleSchema)
      .where(and(
        eq(notificationRuleSchema.orgId, input.orgId),
        core.length > 0
          ? or(eq(notificationRuleSchema.event, input.type), inArray(notificationRuleSchema.kind, core.map(r => r.kind)))
          : eq(notificationRuleSchema.event, input.type),
      ));
    // A stored kind — whatever its event or status — replaces core's kind of the same name.
    const declared = new Set(stored.map(r => r.kind));
    rules = [
      ...stored.filter(r => r.status === 'active' && r.event === input.type).map(r => ({ id: r.id, kind: r.kind, config: r.config })),
      ...core.filter(r => !declared.has(r.kind)).map(r => ({ id: null, kind: r.kind, config: r })),
    ];
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
      // The notification leads with what its record is read by — "FE-294 … needs you".
      const code = rendered.record && /^\d+$/.test(rendered.record.id) ? await codeForRecord(input.orgId, Number(rendered.record.id)).catch(() => null) : null;
      const out = await notify({
        orgId: input.orgId,
        kind: rule.kind,
        userIds: recipients.userIds,
        title: code ? `${code} ${rendered.title}` : rendered.title,
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
    if (rule.id !== null) {
      await db.update(notificationRuleSchema).set({ lastFiredAt: new Date(), lastNote: note }).where(eq(notificationRuleSchema.id, rule.id)).catch(() => {});
    } else if (!note.startsWith('notified')) {
      // Core's own kind has no row to write on, so what it could not do is logged.
      console.warn('[notifications] a core notification kind did not reach anyone', { orgId: input.orgId, kind: rule.kind, note });
    }
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
