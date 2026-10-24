/**
 * A MISSION'S RESULT GOES OUT WHEN ITS CHECK FINISHES (ADR 0008), not on a
 * second automation timed to fire twenty minutes after the first. The timed
 * mail could not tell a finished check from a late or failed one, so it sent
 * whatever briefing came last — Friday's update on Monday, as Monday's.
 *
 * `deliver:` on the mission says where the result goes. When a check ends:
 * - it published a briefing → that briefing is mailed;
 * - it finished and published nothing → nothing is mailed (an alert check
 *   that found nothing worth saying stays quiet);
 * - it failed → a short note says so and links the run. Never an older briefing.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { mailEnabled, MailError, sendMail } from '@/libs/mail';
import { projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { workspaceFrom } from '@/services/mail/workspaceFrom';

export type MissionDelivery = { email: true | string[] };

export type DeliveryOutcome
  = | { delivered: 'briefing'; mail: { sent: boolean; reason?: string } }
    | { delivered: 'failure-note'; mail: { sent: boolean; reason?: string } }
    | { delivered: 'nothing'; reason: string };

/**
 * Deliver what one check of a mission produced.
 * @param opts - The check.
 * @param opts.orgId - The workspace.
 * @param opts.mission - The mission: its name, owning agent and `deliver:`.
 * @param opts.mission.name - Shown in the failure note.
 * @param opts.mission.agentSlug - Whose briefing to mail.
 * @param opts.mission.deliver - Where the result goes; null delivers nothing.
 * @param opts.runId - The check's mission run.
 * @param opts.failed - Why the check did not finish, when it did not.
 * @param opts.startedAt - When the check started: only a briefing published after it is this check's.
 */
export async function deliverCheckResult(opts: {
  orgId: string;
  mission: { name: string; agentSlug: string; deliver: MissionDelivery | null | undefined };
  runId: number;
  failed: string | null;
  startedAt: Date;
}): Promise<DeliveryOutcome> {
  const { deliver } = opts.mission;
  if (!deliver?.email) {
    return { delivered: 'nothing', reason: 'the mission delivers nowhere' };
  }
  const to = deliver.email === true ? undefined : deliver.email;
  if (opts.failed !== null) {
    return { delivered: 'failure-note', mail: await mailFailureNote(opts.orgId, opts.mission.name, opts.runId, opts.failed, to) };
  }
  const { runDailyTeamReportJob } = await import('@/services/jobs/dailyTeamReport');
  const result = await runDailyTeamReportJob(opts.orgId, {
    briefing: { agentSlug: opts.mission.agentSlug },
    since: opts.startedAt.toISOString(),
    requireFresh: true,
    publish: false,
    ...(to ? { to } : {}),
  });
  if (!result.mail.sent && result.mail.reason === 'no briefing was published in this window') {
    return { delivered: 'nothing', reason: 'the check published no briefing' };
  }
  return { delivered: 'briefing', mail: result.mail.sent ? { sent: true } : { sent: false, reason: result.mail.reason } };
}

/**
 * The note a failed check sends instead of a briefing.
 * @param orgId - The workspace.
 * @param missionName - The mission.
 * @param runId - The failed run.
 * @param why - What stopped it.
 * @param to - Addresses; the accountable person when absent.
 */
async function mailFailureNote(orgId: string, missionName: string, runId: number, why: string, to: string[] | undefined): Promise<{ sent: boolean; reason?: string }> {
  const [project] = await db
    .select({ slug: projectSchema.slug, accountSlug: tenantAccountSchema.slug, accountableUserId: projectSchema.accountableUserId })
    .from(projectSchema)
    .innerJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return { sent: false, reason: `no project ${orgId}` };
  }
  let recipients = to ?? [];
  if (recipients.length === 0 && project.accountableUserId) {
    const [u] = await db.select({ email: userSchema.email }).from(userSchema).where(eq(userSchema.id, project.accountableUserId)).limit(1);
    recipients = u?.email ? [u.email] : [];
  }
  if (recipients.length === 0) {
    return { sent: false, reason: 'no recipient: list addresses in deliver.email or set the workspace accountableUser' };
  }
  if (!mailEnabled()) {
    return { sent: false, reason: 'VOCION_MAIL_ENABLED is not 1' };
  }
  const link = workspaceUrl(project.slug, `/dashboard/missions/runs/${runId}`, { absolute: true, accountSlug: project.accountSlug });
  const note = failureNote(missionName, why, link);
  try {
    const from = await workspaceFrom(orgId);
    const res = await sendMail({ to: recipients, subject: note.subject, html: note.html, text: note.text, ...(from ? { from } : {}), tags: { job: 'mission-deliver', org: orgId }, brand: { orgId } });
    return res.skipped ? { sent: false, reason: res.reason } : { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof MailError ? `${err.code}: ${err.message}` : String(err) };
  }
}

/**
 * The failure note's words. Pure.
 * @param missionName - The mission.
 * @param why - What stopped the check.
 * @param link - The run.
 */
export function failureNote(missionName: string, why: string, link: string): { subject: string; text: string; html: string } {
  const reason = why.replace(/\s+/g, ' ').trim().slice(0, 300) || 'it stopped without saying why';
  const text = `${missionName} did not finish this time: ${reason}\n\nNothing older was sent in its place. The run: ${link}`;
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = `<p>${esc(missionName)} did not finish this time: ${esc(reason)}</p><p>Nothing older was sent in its place. <a href="${esc(link)}">Open the run</a></p>`;
  return { subject: `${missionName} did not finish`, text, html };
}
