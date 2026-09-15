/**
 * `daily-team-report` — the built-in automation job.
 *
 *   automations/daily-team-report.yaml
 *     when: { schedule: '0 13 * * *' }
 *     do:   { job: daily-team-report, input: { to: [chris@example.com], hours: 24 } }
 *
 *   Or, to mail a team's own briefing in full with its title as the subject:
 *     do:   { job: daily-team-report, input: { briefing: { teamSlug: revops } } }
 *
 * Collects the trailing window (`services/reports/dailyTeamReport.ts`),
 * renders it (`renderDailyTeamReport`), stores the markdown as a workspace-
 * rollup `briefing` so it is readable in-app whether or not mail is on, then
 * mails it when `VOCION_MAIL_ENABLED=1`. Recipients: `input.to` (string or
 * list), else the workspace's accountable human. No recipient and no mail
 * flag is fine — the briefing still lands.
 */

import { db } from '@/libs/DB';
import { mailEnabled, MailError, sendMail } from '@/libs/mail';
import { briefingSchema } from '@/models/Schema';
import { collectDailyTeamReport, DAILY_TEAM_REPORT_PUBLISHER } from '@/services/reports/dailyTeamReport';
import { renderDailyTeamReport } from '@/services/reports/renderDailyTeamReport';

export const DAILY_TEAM_REPORT_JOB = 'daily-team-report';

export type DailyTeamReportJobInput = {
  /** Recipient(s). Defaults to the workspace's accountable user. */
  to?: string | string[];
  /** Window length in hours. Default 24. */
  hours?: number;
  /** Skip the mail step even when the flag is on (dry run / in-app only). */
  mail?: boolean;
  /** Skip storing the briefing row. Default false. */
  publish?: boolean;
  /**
   * Carry a specific briefing instead of the workspace rollup: the latest one
   * for this team and/or agent, in full, with its title as the subject. The
   * revenue workspace mails its `revops` "Revenue Briefing" this way.
   */
  briefing?: { teamSlug?: string; agentSlug?: string };
};

export type DailyTeamReportJobResult = {
  subject: string;
  window: { since: string; until: string };
  runs: number;
  cents: number;
  needsYou: number;
  briefingId: number | null;
  recipients: string[];
  mail: { sent: false; reason: string } | { sent: true; id: string | null };
};

function parseRecipients(to: unknown): string[] {
  const list = Array.isArray(to) ? to : typeof to === 'string' ? to.split(',') : [];
  return list.map(s => String(s).trim()).filter(s => s.includes('@'));
}

export async function runDailyTeamReportJob(orgId: string, rawInput: Record<string, unknown>): Promise<DailyTeamReportJobResult> {
  const input = rawInput as DailyTeamReportJobInput;
  const hours = typeof input.hours === 'number' && input.hours > 0 ? input.hours : 24;
  const until = new Date();
  const since = new Date(until.getTime() - hours * 60 * 60 * 1000);

  const briefing = input.briefing && typeof input.briefing === 'object'
    ? { teamSlug: typeof input.briefing.teamSlug === 'string' ? input.briefing.teamSlug : undefined, agentSlug: typeof input.briefing.agentSlug === 'string' ? input.briefing.agentSlug : undefined }
    : undefined;
  const data = await collectDailyTeamReport(orgId, { since, until }, { briefing });
  const rendered = renderDailyTeamReport(data);

  let briefingId: number | null = null;
  if (input.publish !== false) {
    const [row] = await db
      .insert(briefingSchema)
      .values({
        orgId,
        title: rendered.subject.slice(0, 200),
        content: rendered.markdown,
        publishedBy: `job:${DAILY_TEAM_REPORT_JOB}`,
        agentSlug: DAILY_TEAM_REPORT_PUBLISHER,
        teamSlug: null,
      })
      .returning({ id: briefingSchema.id });
    briefingId = row?.id ?? null;
  }

  const recipients = parseRecipients(input.to);
  if (recipients.length === 0 && data.workspace.accountableEmail) {
    recipients.push(data.workspace.accountableEmail);
  }

  let mail: DailyTeamReportJobResult['mail'];
  if (input.mail === false) {
    mail = { sent: false, reason: 'input.mail=false' };
  } else if (!mailEnabled()) {
    mail = { sent: false, reason: 'VOCION_MAIL_ENABLED is not 1' };
  } else if (recipients.length === 0) {
    mail = { sent: false, reason: 'no recipient: pass input.to or set the workspace accountableUser' };
  } else {
    try {
      const res = await sendMail({ to: recipients, subject: rendered.subject, html: rendered.html, text: rendered.text, tags: { job: DAILY_TEAM_REPORT_JOB, org: orgId } });
      mail = res.skipped ? { sent: false, reason: res.reason } : { sent: true, id: res.id };
    } catch (err) {
      // The briefing is already stored; a provider failure is reported, not fatal.
      const message = err instanceof MailError ? `${err.code}: ${err.message}` : String(err);
      mail = { sent: false, reason: message };
    }
  }

  return {
    subject: rendered.subject,
    window: { since: since.toISOString(), until: until.toISOString() },
    runs: data.totals.runs,
    cents: data.totals.cents,
    needsYou: data.needsYou.total,
    briefingId,
    recipients,
    mail,
  };
}
