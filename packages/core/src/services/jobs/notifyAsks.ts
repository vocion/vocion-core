/**
 * `notify-asks` — the built-in automation job that emails a workspace's
 * accountable human about asks that opened since the last notification.
 *
 *   automations/notify-asks.yaml
 *     when: { schedule: '*\/15 * * * *' }
 *     do:   { job: notify-asks, input: { to: [chris@example.com] } }
 *
 * One mail per run, grouped, never more than one every `minIntervalMinutes`
 * (default 15) per org: the job reads `ask.notified = false` rows whose
 * `notify_at` has passed, mails them as one list with deep links into the
 * "Needs you" inbox, and marks them notified. Sent from the workspace's own
 * mailbox when it has one (`services/mail/workspaceFrom.ts`), else the
 * deployment sender. With mail off the job is a no-op that reports what it
 * would have sent — the inbox itself is always the source of truth.
 */

import process from 'node:process';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mailEnabled, sendMail } from '@/libs/mail';
import { askSchema, projectSchema, userSchema } from '@/models/Schema';
import { markNotified, pendingNotifications } from '@/services/AskService';
import { workspaceFrom } from '@/services/mail/workspaceFrom';

export const NOTIFY_ASKS_JOB = 'notify-asks';

export type NotifyAsksInput = {
  /** Recipient(s). Defaults to the workspace's accountable user. */
  to?: string | string[];
  /** Do not mail more often than this, per org. Default 15. */
  minIntervalMinutes?: number;
  /** Skip the mail even when the flag is on. */
  mail?: boolean;
};

export type NotifyAsksResult = {
  pending: number;
  recipients: string[];
  mail: { sent: false; reason: string } | { sent: true; id: string | null; asks: number };
};

function parseRecipients(to: unknown): string[] {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? to.split(',') : [];
  return list.map(s => String(s).trim()).filter(s => s.includes('@'));
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

const KIND_LABEL: Record<string, string> = {
  approval: 'Approval',
  input: 'Input',
  ruling: 'Ruling',
  credential: 'Credential',
  merge: 'Merge',
  recommendation: 'Recommendation',
  gate: 'Gate',
};

/**
 * Render the notification. Exported for the snapshot test.
 * @param asks - Open, un-notified asks.
 * @param workspaceName - For the subject.
 */
export function renderAskNotification(asks: { id: number; kind: string; title: string; agentSlug: string | null; risk: string | null; groupTitle: string | null }[], workspaceName: string): { subject: string; text: string; html: string } {
  const base = appUrl();
  const subject = asks.length === 1
    ? `Needs you — ${asks[0]!.title}`
    : `Needs you — ${asks.length} decisions waiting (${workspaceName})`;
  const lines = asks.map((a) => {
    const who = a.agentSlug ? ` · asked by ${a.agentSlug}` : '';
    const risk = a.risk ? ` · ${a.risk} risk` : '';
    const group = a.groupTitle ? ` · sheet: ${a.groupTitle}` : '';
    return `• [${KIND_LABEL[a.kind] ?? a.kind}] ${a.title}${who}${risk}${group}\n  ${base}/dashboard/inbox/${a.id}`;
  });
  const text = `${asks.length === 1 ? 'One decision is' : `${asks.length} decisions are`} waiting for you in ${workspaceName}.\n\n${lines.join('\n\n')}\n\nOpen the inbox: ${base}/dashboard/inbox`;
  const items = asks.map((a) => {
    const meta = [KIND_LABEL[a.kind] ?? a.kind, a.agentSlug ? `asked by ${a.agentSlug}` : null, a.risk ? `${a.risk} risk` : null, a.groupTitle ? `sheet: ${a.groupTitle}` : null].filter(Boolean).join(' · ');
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee"><a href="${base}/dashboard/inbox/${a.id}" style="color:#0b1020;font-weight:600;text-decoration:none">${escape(a.title)}</a><div style="color:#666;font-size:13px;margin-top:2px">${escape(meta)}</div></td></tr>`;
  }).join('');
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0b1020;max-width:560px"><p>${asks.length === 1 ? 'One decision is' : `${asks.length} decisions are`} waiting for you in <strong>${escape(workspaceName)}</strong>.</p><table style="width:100%;border-collapse:collapse">${items}</table><p style="margin-top:16px"><a href="${base}/dashboard/inbox" style="display:inline-block;background:#0b1020;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open the inbox</a></p></div>`;
  return { subject, text, html };
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function runNotifyAsksJob(orgId: string, rawInput: Record<string, unknown>): Promise<NotifyAsksResult> {
  const input = rawInput as NotifyAsksInput;
  const minInterval = typeof input.minIntervalMinutes === 'number' && input.minIntervalMinutes >= 0 ? input.minIntervalMinutes : 15;

  const pending = await pendingNotifications({ orgId, limit: 50 });
  if (pending.length === 0) {
    return { pending: 0, recipients: [], mail: { sent: false, reason: 'nothing pending' } };
  }

  // Throttle: the newest notified ask's updated_at is when we last mailed.
  const [last] = await db
    .select({ at: askSchema.updatedAt })
    .from(askSchema)
    .where(eq(askSchema.orgId, orgId))
    .orderBy(desc(askSchema.updatedAt))
    .limit(1);
  const [lastNotified] = await db
    .select({ at: askSchema.updatedAt })
    .from(askSchema)
    .where(eq(askSchema.notified, true))
    .orderBy(desc(askSchema.updatedAt))
    .limit(1);
  void last;
  if (lastNotified && Date.now() - lastNotified.at.getTime() < minInterval * 60_000) {
    return { pending: pending.length, recipients: [], mail: { sent: false, reason: `throttled (${minInterval} min)` } };
  }

  const [project] = await db
    .select({ name: projectSchema.name, accountableUserId: projectSchema.accountableUserId })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  let recipients = parseRecipients(input.to);
  if (recipients.length === 0 && project?.accountableUserId) {
    const [u] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, project.accountableUserId)).limit(1);
    if (u?.email) {
      recipients = [u.email];
    }
  }
  if (recipients.length === 0) {
    return { pending: pending.length, recipients, mail: { sent: false, reason: 'no recipient (set input.to or the workspace accountableUser)' } };
  }
  if (input.mail === false || !mailEnabled()) {
    return { pending: pending.length, recipients, mail: { sent: false, reason: input.mail === false ? 'mail: false' : 'VOCION_MAIL_ENABLED is not 1' } };
  }

  const rendered = renderAskNotification(pending.map(a => ({ id: a.id, kind: a.kind, title: a.title, agentSlug: a.agentSlug, risk: a.risk, groupTitle: a.groupTitle })), project?.name ?? 'your workspace');
  const from = await workspaceFrom(orgId);
  const sent = await sendMail({ to: recipients, subject: rendered.subject, text: rendered.text, html: rendered.html, ...(from ? { from } : {}), tags: { job: NOTIFY_ASKS_JOB } });
  await markNotified(orgId, pending.map(a => a.id));
  return { pending: pending.length, recipients, mail: sent.skipped ? { sent: false, reason: 'disabled' } : { sent: true, id: sent.id, asks: pending.length } };
}
