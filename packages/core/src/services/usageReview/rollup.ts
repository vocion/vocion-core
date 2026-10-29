/**
 * The operator's roll-up: yesterday across every workspace on this deployment.
 *
 * Each workspace's daily usage review is its own briefing (`report.ts`). The
 * roll-up reads those briefings back — the report is the artifact, so nothing
 * else stores the day — and gathers them for the people who operate the
 * deployment. Core has no operator: an extension names them
 * (`libs/extensions.ts`, `usageReview.operators`), and without one there is
 * no roll-up at all. It never leaves the deployment it was built on: a
 * self-hosted install's roll-up goes to that install's own operator.
 *
 * What crosses an Org's boundary is decided per Org, now (`privacy.ts`):
 *
 *   content    the workspace's numbers and friction themes, plus the threads
 *              most worth a look (with what would have been better), the
 *              connectors and skills people needed and the effort mismatches,
 *              each linked to its thread;
 *   metadata   the numbers and the theme counts — labels from code. Nothing a
 *              person wrote, and no thread's name.
 *
 * An Org read with content in its own report but switched off since is rolled
 * up as metadata: the stricter of the two always wins.
 */

import type { ReadMode, ReadModeWhy } from './privacy';
import type { CapabilityRequest, OperatorRollup, RollupWorkspace } from './types';
import type { PublishBriefingInput } from '@/services/briefings/agentInput';
import type { BriefingV2 } from '@/services/briefings/document';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { capabilityRequestObservers, usageReviewOperators, usageRollupObservers } from '@/libs/extensions';
import { workspaceUrl } from '@/libs/links';
import { actionRunSchema, briefingSchema, projectSchema, tenantAccountSchema, userSchema } from '@/models/Schema';
import { READ_MODE_LABEL, READ_MODE_WHY_LABEL, readModeForAccount } from './privacy';
import { METRIC, TABLE } from './report';

/** The roll-up's name on the operator's Briefings; the publisher adds the date. */
export const ROLLUP_TITLE = 'Usage across workspaces';

/** How far back a workspace's review counts as yesterday's: a day, plus slack for time zones. */
const ROLLUP_WINDOW_MS = 26 * 3_600_000;

/** The seat the reports are published under (`UsageReviewService.USAGE_REVIEW_SEAT`). */
const SEAT = 'workspace-manager';

/**
 * A table cell as `[label](href)`, or as plain text. Pure.
 * @param cell - The cell.
 */
export function parseLinkCell(cell: string): { label: string; href: string | null } {
  const m = cell.match(/^\[([^\]]*)\]\(([^)\s]+)\)$/);
  return m ? { label: m[1]!, href: m[2]! } : { label: cell, href: null };
}

/**
 * One workspace's report, read back from its briefing. Content-level lines are
 * kept only when `mode` is content. Pure.
 * @param doc - The briefing document.
 * @param ws - Who it belongs to, and how the Org may be rolled up now.
 * @param ws.orgId - The workspace.
 * @param ws.workspaceName - Its name.
 * @param ws.accountId - Its Org.
 * @param ws.orgName - The Org's name.
 * @param ws.href - The report, absolute.
 * @param ws.mode - The stricter of the report's mode and the Org's mode now.
 * @param ws.why - Why.
 * @param absolute - Makes a workspace path absolute.
 */
export function rollupWorkspaceFrom(
  doc: BriefingV2,
  ws: { orgId: string; workspaceName: string; accountId: string | null; orgName: string | null; href: string; mode: ReadMode; why: ReadModeWhy },
  absolute: (path: string) => string,
): RollupWorkspace {
  const metric = (key: string) => doc.today?.metrics.find(m => m.key === key)?.value ?? null;
  const table = (title: string) => doc.detail?.tables.find(t => t.title === title)?.rows ?? [];
  const themes = (doc.exceptions?.items ?? [])
    .filter(e => e.key.startsWith('theme-'))
    .map((e) => {
      const m = e.label.match(/^(.*) · (\d+) threads?$/);
      return m ? { label: m[1]!, count: Number(m[2]) } : { label: e.label, count: 1 };
    });
  const content = ws.mode === 'content';
  return {
    orgId: ws.orgId,
    workspaceName: ws.workspaceName,
    accountId: ws.accountId,
    orgName: ws.orgName,
    mode: ws.mode,
    why: ws.why,
    href: ws.href,
    threads: metric(METRIC.threads),
    outcomeRate: metric(METRIC.outcome),
    reaskRate: metric(METRIC.reask),
    approvals: metric(METRIC.approvals),
    themes,
    worthALook: content
      ? table(TABLE.worthALook).map((r) => {
          const link = parseLinkCell(r[0] ?? '');
          return { thread: link.label, href: link.href ? absolute(link.href) : null, outcome: r[1] ?? '', better: r[2] ?? '' };
        })
      : [],
    missing: content ? table(TABLE.missing).map(r => ({ kind: r[0] ?? '', name: r[1] ?? '', why: r[3] ?? '' })) : [],
    effort: content ? table(TABLE.effort).map(r => ({ thread: parseLinkCell(r[0] ?? '').label, ranAt: r[1] ?? '', needed: r[2] ?? '' })) : [],
  };
}

/**
 * The mode a report was read in, from its own "How this review read" table.
 * Pure; anything unreadable is metadata.
 * @param doc - The briefing document.
 */
export function reportMode(doc: BriefingV2): ReadMode {
  const row = doc.detail?.tables.find(t => t.title === TABLE.mode)?.rows[0];
  return row?.[0] === READ_MODE_LABEL.content ? 'content' : 'metadata';
}

/**
 * The roll-up as a briefing for the operator. Pure.
 * @param rollup - The day across workspaces.
 */
export function rollupBriefing(rollup: OperatorRollup): PublishBriefingInput {
  const ws = rollup.workspaces;
  const threads = ws.reduce((n, w) => n + (w.threads ?? 0), 0);
  const weighted = (pick: (w: RollupWorkspace) => number | null) => {
    const rows = ws.filter(w => pick(w) !== null && (w.threads ?? 0) > 0);
    const of = rows.reduce((n, w) => n + (w.threads ?? 0), 0);
    return of > 0 ? Math.round(rows.reduce((n, w) => n + pick(w)! * (w.threads ?? 0), 0) / of) : null;
  };
  const outcome = weighted(w => w.outcomeRate);
  const reask = weighted(w => w.reaskRate);
  const themes = new Map<string, { count: number; where: RollupWorkspace[] }>();
  for (const w of ws) {
    for (const t of w.themes) {
      const had = themes.get(t.label) ?? { count: 0, where: [] };
      had.count += t.count;
      had.where.push(w);
      themes.set(t.label, had);
    }
  }
  const name = (w: RollupWorkspace) => `${w.workspaceName}${w.orgName ? ` (${w.orgName})` : ''}`;
  const link = (label: string, href: string | null) => (href ? `[${label}](${href})` : label);
  const tables: PublishBriefingInput['detail'] = [{
    title: 'Workspaces',
    columns: ['Workspace', 'Read as', 'Threads', 'Got there', 'Asked again'],
    rows: ws.map(w => [link(name(w), w.href), `${READ_MODE_LABEL[w.mode]} — ${READ_MODE_WHY_LABEL[w.why]}`, String(w.threads ?? '—'), w.outcomeRate === null ? '—' : `${w.outcomeRate}%`, w.reaskRate === null ? '—' : `${w.reaskRate}%`]),
  }];
  const look = ws.flatMap(w => w.worthALook.map(l => [w.workspaceName, link(l.thread, l.href), l.outcome, l.better]));
  if (look.length > 0) {
    tables.push({ title: 'Threads worth a look', columns: ['Workspace', 'Thread', 'Outcome', 'What would have been better'], rows: look.slice(0, 12) });
  }
  const missing = ws.flatMap(w => w.missing.map(m => [m.name, m.kind, w.workspaceName, m.why]));
  if (missing.length > 0) {
    tables.push({ title: 'Missing connectors and skills', columns: ['What', 'Kind', 'Workspace', 'What it would have done'], rows: missing.slice(0, 12) });
  }
  const effort = ws.flatMap(w => w.effort.map(e => [w.workspaceName, e.thread, e.ranAt, e.needed]));
  if (effort.length > 0) {
    tables.push({ title: 'Effort mismatches', columns: ['Workspace', 'Thread', 'Ran at', 'Needed'], rows: effort.slice(0, 12) });
  }
  if (rollup.requests.length > 0) {
    tables.push({ title: 'Capability requests approved', columns: ['What', 'Kind', 'Workspace', 'Why'], rows: rollup.requests.slice(0, 12).map(r => [r.name, r.capability, ws.find(w => w.orgId === r.orgId)?.workspaceName ?? r.orgId, r.need]) });
  }
  return {
    title: ROLLUP_TITLE,
    summary: ws.length === 0
      ? 'No workspace was used yesterday.'
      : `${ws.length} ${ws.length === 1 ? 'workspace' : 'workspaces'} and ${threads} ${threads === 1 ? 'thread' : 'threads'} yesterday${outcome === null ? '' : `; ${outcome}% of readable outcomes got there`}.`,
    metrics: [
      { key: 'rollup_workspaces', label: 'Workspaces used', value: ws.length, unit: 'count', provenance: 'observed', evidence: [] },
      { key: 'rollup_threads', label: 'Chat threads', value: threads, unit: 'count', provenance: 'observed', evidence: [] },
      ...(outcome === null ? [] : [{ key: 'rollup_outcome_rate', label: 'Got where they wanted', value: outcome, unit: 'pct', provenance: 'agent-reported' as const, evidence: [] }]),
      ...(reask === null ? [] : [{ key: 'rollup_reask_rate', label: 'Had to ask again', value: reask, unit: 'pct', provenance: 'observed' as const, evidence: [] }]),
    ],
    narratives: {},
    whyNow: {},
    incidents: {},
    criticalPath: [],
    exceptions: [...themes.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 3).map(([label, t]) => ({
      key: `rollup-theme-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: `${label} · ${t.count} ${t.count === 1 ? 'thread' : 'threads'}`,
      why: `In ${t.where.map(w => w.workspaceName).join(', ')}.`,
      severity: 'risk' as const,
      evidence: t.where.slice(0, 6).map(w => ({ kind: 'team-briefing', id: w.orgId, label: w.workspaceName, href: w.href })),
    })),
    detail: tables.slice(0, 6),
  };
}

/**
 * The roll-up as mail: the summary and every table, links absolute. Pure.
 * @param input - The briefing input.
 */
export function rollupMarkdown(input: PublishBriefingInput): string {
  const out = [`# ${input.title}`, '', input.summary ?? '', ''];
  for (const e of input.exceptions) {
    out.push(`- **${e.label}** — ${e.why}`);
  }
  for (const t of input.detail) {
    out.push('', `## ${t.title}`, '', `| ${t.columns.join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`, ...t.rows.map(r => `| ${r.map(c => c.replace(/\|/g, '/')).join(' | ')} |`));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Build yesterday's roll-up from every workspace's report. Reads; writes nothing.
 * @param now - The clock.
 */
export async function buildOperatorRollup(now: Date = new Date()): Promise<OperatorRollup> {
  const since = new Date(now.getTime() - ROLLUP_WINDOW_MS);
  const reports = await db
    .select({ id: briefingSchema.id, orgId: briefingSchema.orgId, document: briefingSchema.document, createdAt: briefingSchema.createdAt })
    .from(briefingSchema)
    .where(and(eq(briefingSchema.agentSlug, SEAT), eq(briefingSchema.teamSlug, SEAT), gte(briefingSchema.createdAt, since)));
  // The newest report per workspace; an operator's own roll-up is not a workspace's report.
  const latest = new Map<string, typeof reports[number]>();
  for (const r of reports) {
    if (r.document && r.document.title.startsWith('Daily usage review') && (!latest.has(r.orgId) || latest.get(r.orgId)!.createdAt < r.createdAt)) {
      latest.set(r.orgId, r);
    }
  }
  const orgIds = [...latest.keys()];
  if (orgIds.length === 0) {
    return { asOf: now.toISOString(), workspaces: [], requests: [] };
  }
  const projects = await db
    .select({ id: projectSchema.id, name: projectSchema.name, slug: projectSchema.slug, kind: projectSchema.kind, accountId: projectSchema.accountId, orgName: tenantAccountSchema.name, accountSlug: tenantAccountSchema.slug })
    .from(projectSchema)
    .leftJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
    .where(inArray(projectSchema.id, orgIds));
  const modeNow = new Map<string, Awaited<ReturnType<typeof readModeForAccount>>>();
  const workspaces: RollupWorkspace[] = [];
  for (const p of projects) {
    if (p.kind === 'personal') {
      continue;
    }
    const report = latest.get(p.id)!;
    const key = p.accountId ?? '';
    if (!modeNow.has(key)) {
      modeNow.set(key, await readModeForAccount(p.accountId));
    }
    const now_ = modeNow.get(key)!;
    // The stricter of the two: content only when the report was read with it AND the Org still allows it.
    const mode: ReadMode = reportMode(report.document!) === 'content' && now_.mode === 'content' ? 'content' : 'metadata';
    const absolute = (path: string) => workspaceUrl(p.slug, path, { absolute: true, ...(p.accountSlug ? { accountSlug: p.accountSlug } : {}) });
    workspaces.push(rollupWorkspaceFrom(report.document!, { orgId: p.id, workspaceName: p.name, accountId: p.accountId, orgName: p.orgName, href: absolute(`/dashboard/briefings/${report.id}`), mode, why: now_.why }, absolute));
  }
  workspaces.sort((a, b) => (b.threads ?? 0) - (a.threads ?? 0));

  // Requests people approved in the window, from content-mode workspaces only.
  const contentOrgs = workspaces.filter(w => w.mode === 'content').map(w => w.orgId);
  const approved = contentOrgs.length === 0
    ? []
    : await db
        .select({ orgId: actionRunSchema.orgId, input: actionRunSchema.input, decidedBy: actionRunSchema.decidedBy })
        .from(actionRunSchema)
        .where(and(eq(actionRunSchema.actionId, 'org.change'), eq(actionRunSchema.status, 'done'), inArray(actionRunSchema.orgId, contentOrgs), gte(actionRunSchema.createdAt, since)));
  const requests: CapabilityRequest[] = approved.flatMap((r) => {
    const change = (r.input as { change?: { kind?: string; capability?: CapabilityRequest['capability']; name?: string; need?: string } }).change;
    return change?.kind === 'request_capability' && change.capability && change.name
      ? [{ orgId: r.orgId, capability: change.capability, name: change.name, need: change.need ?? '', evidence: [], decidedBy: r.decidedBy }]
      : [];
  });
  return { asOf: now.toISOString(), workspaces, requests };
}

export type RollupRun
  = | { skipped: 'no_operator' }
    | { workspaces: number; published: Array<{ email: string; briefingId: number | null; why?: string }>; mailed: { sent: boolean; reason?: string }; observers: number };

/**
 * Build the roll-up and hand it to the operator: their Briefings, their inbox
 * when mail is on, and any extension observer. Nothing happens on a deployment
 * that names no operator.
 * @param opts - The clock.
 * @param opts.now - The end of the day read.
 */
export async function runOperatorRollup(opts: { now?: Date } = {}): Promise<RollupRun> {
  const operators = usageReviewOperators();
  const observers = usageRollupObservers();
  if (operators.length === 0 && observers.length === 0) {
    return { skipped: 'no_operator' };
  }
  const now = opts.now ?? new Date();
  const rollup = await buildOperatorRollup(now);
  const input = rollupBriefing(rollup);

  const published: Array<{ email: string; briefingId: number | null; why?: string }> = [];
  if (operators.length > 0) {
    const users = await db.select({ id: userSchema.id, email: userSchema.email }).from(userSchema).where(inArray(userSchema.email, operators));
    const byEmail = new Map(users.map(u => [u.email.toLowerCase(), u.id]));
    const [{ homeAccountFor, ensurePersonalProject }, { publishBriefingDocument }] = await Promise.all([import('@/services/workspace/personalProject'), import('@/services/briefings/store')]);
    for (const email of operators) {
      const userId = byEmail.get(email);
      const home = userId ? await homeAccountFor(userId) : null;
      if (!userId || !home) {
        published.push({ email, briefingId: null, why: 'no login with this address on this deployment' });
        continue;
      }
      try {
        const personal = await ensurePersonalProject(userId, home);
        const res = await publishBriefingDocument(personal.id, input, { teamSlug: SEAT, agentSlug: SEAT, now });
        published.push({ email, briefingId: res.id });
      } catch (err) {
        published.push({ email, briefingId: null, why: (err as Error).message });
      }
    }
  }

  const mailed = await mailRollup(operators, input);
  for (const observe of observers) {
    try {
      await observe(rollup);
    } catch (err) {
      console.error('[usageReview] a roll-up observer failed', (err as Error).message);
    }
  }
  return { workspaces: rollup.workspaces.length, published, mailed, observers: observers.length };
}

/**
 * Mail the roll-up to the operator, when mail is on.
 * @param to - The operator's addresses.
 * @param input - The roll-up.
 */
async function mailRollup(to: string[], input: PublishBriefingInput): Promise<{ sent: boolean; reason?: string }> {
  if (to.length === 0) {
    return { sent: false, reason: 'no operator address' };
  }
  const { mailEnabled, sendMail, MailError } = await import('@/libs/mail');
  if (!mailEnabled()) {
    return { sent: false, reason: 'VOCION_MAIL_ENABLED is not 1' };
  }
  const { markdownToEmailHtml, markdownToPlainText } = await import('@/services/reports/markdownToEmailHtml');
  const markdown = rollupMarkdown(input);
  const font = 'font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;';
  const html = markdownToEmailHtml(markdown, {
    h1: `${font}font-size:20px;margin:0 0 6px;`,
    h2: `${font}font-size:15px;margin:20px 0 6px;`,
    h3: `${font}font-size:13.5px;margin:14px 0 4px;`,
    p: `${font}font-size:14px;line-height:1.55;margin:0 0 8px;`,
    ul: `${font}font-size:14px;line-height:1.55;padding-left:20px;`,
    ol: `${font}font-size:14px;line-height:1.55;padding-left:20px;`,
    li: 'margin:0 0 3px;',
    a: 'color:#2563eb;text-decoration:underline;',
    code: 'font-family:monospace;font-size:12.5px;',
    hr: 'border:0;border-top:1px solid #e5e7eb;margin:16px 0;',
    table: `${font}font-size:13px;border-collapse:collapse;width:100%;margin:0 0 10px;`,
    th: 'text-align:left;padding:5px 8px;border:1px solid #e5e7eb;background:#f9fafb;font-size:12px;',
    td: 'padding:5px 8px;border:1px solid #e5e7eb;vertical-align:top;',
    blockquote: `${font}font-size:13px;margin:0 0 8px;padding:8px 12px;border-left:3px solid #d1d5db;`,
  });
  try {
    const res = await sendMail({ to, subject: input.title, html, text: markdownToPlainText(markdown), tags: { job: 'usage-review-rollup' }, brand: 'install' });
    return res.skipped ? { sent: false, reason: res.reason } : { sent: true };
  } catch (err) {
    return { sent: false, reason: err instanceof MailError ? `${err.code}: ${err.message}` : String(err) };
  }
}

/**
 * A person approved a capability request the review filed: tell the
 * extensions that file it where the platform is built. Never throws — the
 * approved run is the request whatever an observer does.
 * @param request - What was requested.
 */
export async function capabilityRequested(request: CapabilityRequest): Promise<void> {
  for (const observe of capabilityRequestObservers()) {
    try {
      await observe(request);
    } catch (err) {
      console.error('[usageReview] a capability-request observer failed', (err as Error).message);
    }
  }
}
