/**
 * Daily team report — the rendering half. Pure: `DailyTeamReportData` in,
 * `{ subject, html, text, markdown }` out. No DB, no env, no clock (the data
 * carries `generatedAt`), so the snapshot test pins the exact mail.
 *
 * Order follows the Product Design Manifesto (`docs/MANIFESTO.md`) and the
 * team-report spec (`docs/specs/team-report-v2.md`): the mail leads with
 * **Performance** — goal attainment per team with its provenance, human
 * load, cost per outcome, what needs attention — then answers **What
 * changed? What needs me? Are we on track? What happens next?**, with the
 * per-team activity table after and tokens only in the evidence footer. No
 * metric appears without the outcome it serves, and the whole thing should
 * read in one screen on a phone. `reportSections()` is that structure; the
 * markdown and the HTML both render from it so they cannot drift.
 *
 * Email constraints honoured here:
 *   - one column, ≤ 640px, table-based layout;
 *   - every style inline (no <style> reliance, no external assets, no images);
 *   - dark-mode safe: `color-scheme: light dark`, neutral greys;
 *   - a full plain-text alternative;
 *   - the same content as markdown, which is what the job stores as a
 *     `briefing` row so the report is readable in-app when mail is off.
 */

import type { DailyTeamReportData, MemberStats, TeamPerformance, TeamStats } from './dailyTeamReportShape';
import type { EmailStyles } from './markdownToEmailHtml';
import { escapeHtml, markdownToEmailHtml, markdownToPlainText } from './markdownToEmailHtml';

export type RenderedReport = { subject: string; html: string; text: string; markdown: string };

const FONT = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;';
const MONO = 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;';
const INK = 'color:#1f2328;';
const MUTED = 'color:#6b7280;';
const BORDER = 'border:1px solid #e5e7eb;';

const ST: EmailStyles = {
  h1: `${FONT}${INK}font-size:20px;line-height:1.3;margin:0 0 4px;font-weight:650;`,
  h2: `${FONT}${INK}font-size:15px;line-height:1.35;margin:22px 0 6px;font-weight:650;letter-spacing:-0.01em;`,
  h3: `${FONT}${INK}font-size:13.5px;line-height:1.4;margin:14px 0 4px;font-weight:650;`,
  p: `${FONT}${INK}font-size:14px;line-height:1.55;margin:0 0 8px;`,
  ul: `${FONT}${INK}font-size:14px;line-height:1.55;margin:0 0 8px;padding-left:20px;`,
  ol: `${FONT}${INK}font-size:14px;line-height:1.55;margin:0 0 8px;padding-left:20px;`,
  li: 'margin:0 0 3px;',
  a: 'color:#2563eb;text-decoration:underline;',
  code: `${MONO}font-size:12.5px;background:#f3f4f6;color:#1f2328;padding:1px 4px;border-radius:3px;`,
  hr: 'border:0;border-top:1px solid #e5e7eb;margin:16px 0;',
  table: `${FONT}${INK}font-size:13px;border-collapse:collapse;width:100%;margin:0 0 10px;`,
  th: `text-align:left;padding:5px 8px;${BORDER}background:#f9fafb;font-weight:600;font-size:11.5px;${MUTED}text-transform:uppercase;letter-spacing:0.02em;`,
  td: `padding:5px 8px;${BORDER}vertical-align:top;`,
  blockquote: `${MONO}${INK}font-size:12.5px;line-height:1.5;margin:0 0 8px;padding:8px 12px;background:#f9fafb;border-left:3px solid #d1d5db;white-space:pre-wrap;`,
};

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const STAMP_FMT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** How much of the workspace briefing rides along before we link to the rest. */
const ROLLUP_EXCERPT_CHARS = 1200;
/** A member this close to a hard budget cap is a "watch" line. */
const BUDGET_WATCH_RATIO = 0.8;

export function usd(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 100 ? `$${Math.round(dollars).toLocaleString('en-US')}` : `$${dollars.toFixed(2)}`;
}

export function compactTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }
  return String(n);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * "2h 18m" / "46 min" / "0".
 * @param ms
 */
export function reviewTime(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m <= 0) {
    return ms > 0 ? '<1 min' : '0';
  }
  if (m < 60) {
    return `${m} min`;
  }
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * A measure reading in its unit — `$` as dollars, `%` as a percentage, else
 * the number with the unit.
 * @param value
 * @param unit
 */
function measureValue(value: number, unit: string | undefined): string {
  if (unit === '$') {
    return usd(Math.round(value * 100));
  }
  if (unit === '%') {
    return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`;
  }
  const n = Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return unit ? `${n} ${unit}` : n;
}

const PROVENANCE_WORD: Record<string, string> = { 'verified': 'verified', 'observed': 'observed', 'human-confirmed': 'human-confirmed', 'agent-reported': 'agent-reported — the worker\'s own count' };

/**
 * One team's performance line for the Performance section, e.g.
 * "**Founder GTM** — 8 / 10 referrals · 80% of weekly target · ↑3 · human-confirmed · 17 min review · $6.14/referral".
 * @param t
 */
export function performanceLine(t: TeamPerformance): string {
  const bits: string[] = [];
  if (t.primary) {
    const p = t.primary;
    // A word unit is carried by the label, so the figures stay bare: "8 / 10 qualified referrals".
    const unit = p.unit === '$' || p.unit === '%' ? p.unit : undefined;
    const value = p.value === null ? '—' : measureValue(p.value, unit);
    bits.push(`${value} / ${measureValue(p.target, unit)} ${p.label}`);
    if (p.attainment !== null) {
      bits.push(`${Math.round(p.attainment * 100)}% of ${p.window === '24h' ? 'daily' : p.window === '7d' ? 'weekly' : p.window === '30d' ? '30-day' : 'quarterly'} target${p.met ? ' ✓' : ''}`);
    }
    if (p.delta !== null && p.delta !== 0) {
      bits.push(`${p.delta > 0 ? '↑' : '↓'}${measureValue(Math.abs(p.delta), unit)} vs prior`);
    }
    bits.push(PROVENANCE_WORD[p.provenance] ?? p.provenance);
  } else {
    bits.push('no measure yet');
  }
  bits.push(t.humanLoad.interventions === 0 ? 'no human interventions' : `${reviewTime(t.humanLoad.reviewMs)} review over ${plural(t.humanLoad.interventions, 'intervention')}`);
  if (t.costPerOutcomeCents !== null && t.primary) {
    const per = t.primary.unit && t.primary.unit !== '$' && t.primary.unit !== '%' ? t.primary.unit.replace(/s$/, '') : t.primary.label.toLowerCase().replace(/s$/, '');
    bits.push(`${usd(Math.round(t.costPerOutcomeCents))}/${per}`);
  } else if (t.cents > 0) {
    bits.push(`${usd(t.cents)} operating cost`);
  } else {
    bits.push('no spend in the window');
  }
  if (t.needsYou > 0) {
    bits.push(`**${plural(t.needsYou, 'item')} need${t.needsYou === 1 ? 's' : ''} you**`);
  }
  return `**${t.name}** — ${bits.join(' · ')}`;
}

function kindBadges(m: MemberStats): string {
  const parts: string[] = [];
  if (m.byKind.board) {
    parts.push(`board×${m.byKind.board}`);
  }
  if (m.byKind['red-team']) {
    parts.push(`red-team×${m.byKind['red-team']}`);
  }
  return parts.join(' ');
}

export function subjectFor(data: DailyTeamReportData): string {
  if (data.rollup?.full) {
    return data.rollup.title;
  }
  return `Team report — ${data.workspace.name} — ${WEEKDAY_FMT.format(data.window.until)}`;
}

export type OnTrackStatus = 'on-track' | 'watch' | 'off-track';

/**
 * The manifesto's four questions, answered from the data. Plain strings in
 * markdown inline syntax (bold, code, links) — both renderers inline-format
 * them the same way.
 */
export type ReportSections = {
  /** Performance — goal attainment per team, human load, cost per outcome. Leads the mail. */
  performance: { headline: string[]; teams: string[]; setup: string | null };
  /** What changed — outcomes, most consequential first. */
  changed: string[];
  /** What needs me — the count and the lines behind it. */
  needsMe: { total: number; lines: string[] };
  /** Are we on track — a verdict and the signals behind it. */
  onTrack: { status: OnTrackStatus; lines: string[] };
  /** What happens next. */
  next: string[];
  /** The workspace briefing, excerpted; `truncated` says a link is owed. */
  rollup: { title: string; publishedAt: string; excerpt: string; truncated: boolean; label: string } | null;
  /** Evidence — the counts everything above is derived from. */
  evidence: { label: string; value: string }[];
};

/**
 * Derive the sections. Pure, exported for the test.
 * @param data - Collected report data.
 */
export function reportSections(data: DailyTeamReportData): ReportSections {
  const { totals, needsYou } = data;
  const members = data.teams.flatMap(t => t.members);

  // --- Performance --------------------------------------------------------
  const perf = data.performance;
  const performance: ReportSections['performance'] = { headline: [], teams: [], setup: null };
  if (!perf) {
    performance.setup = 'Team performance could not be read for this window.';
  } else if (perf.setupNeeded) {
    performance.setup = perf.goal
      ? 'Performance is not measured yet — give each team a measure and a target, and this section fills in.'
      : 'Performance is not measured yet — state the workspace outcome and give each team a measure and a target, and this section fills in.';
  } else {
    if (perf.goal) {
      performance.headline.push(`Goal: ${perf.goal}`);
    }
    const head: string[] = [];
    head.push(`**${perf.teamsOnTarget.onTarget} / ${perf.teamsOnTarget.measured}** teams on target`);
    if (perf.goalProgress !== null) {
      head.push(`**${Math.round(perf.goalProgress * 100)}%** goal progress`);
    }
    head.push(`**${reviewTime(perf.humanReviewMs)}** human review`);
    if (perf.autoCompletedRate !== null) {
      head.push(`**${Math.round(perf.autoCompletedRate * 100)}%** of work needed nobody`);
    }
    head.push(perf.needsAttention > 0 ? `**${perf.needsAttention}** need attention` : 'no pending escalations');
    performance.headline.push(head.join(' · '));
    performance.teams = perf.teams.map(performanceLine);
  }
  const activeTeams = data.teams.filter(t => t.members.some(m => m.completed > 0));
  const contributors = members.filter(m => m.completed > 0).sort((a, b) => b.completed - a.completed || b.cents - a.cents);

  // --- What changed -------------------------------------------------------
  const changed: string[] = [];
  if (totals.runs === 0) {
    changed.push('No runs in this window — the team was idle.');
  } else {
    const top = contributors.slice(0, 3).map(m => `${m.name} (${m.completed})`).join(', ');
    changed.push(`**${plural(totals.completed, 'run')} completed** across ${plural(activeTeams.length, 'team')}${top ? ` — most by ${top}` : ''}.`);
    if (totals.kindsKnown && (totals.boardRuns > 0 || totals.redTeamRuns > 0)) {
      const bits: string[] = [];
      if (totals.boardRuns > 0) {
        bits.push(`**${plural(totals.boardRuns, 'board-level review')}**`);
      }
      if (totals.redTeamRuns > 0) {
        bits.push(`**${plural(totals.redTeamRuns, 'red-team grade')}**`);
      }
      changed.push(`${bits.join(' and ')} ran — the oversight loop is turning.`);
    }
    if (totals.failed > 0) {
      const who = members.filter(m => m.failed > 0).map(m => `${m.name} (${m.failed})`).join(', ');
      changed.push(`**${plural(totals.failed, 'run')} failed or went lost** — ${who}.`);
    }
  }

  // --- What needs me ------------------------------------------------------
  const needsLines: string[] = [];
  if (needsYou.pendingActions > 0) {
    needsLines.push(`${plural(needsYou.pendingActions, 'proposed action')} awaiting approval`);
  }
  if (needsYou.runsAwaitingReview > 0) {
    needsLines.push(`${plural(needsYou.runsAwaitingReview, 'run')} awaiting review`);
  }
  if (needsYou.runsPaused > 0) {
    needsLines.push(`${plural(needsYou.runsPaused, 'run')} paused until someone decides`);
  }
  if (needsYou.pendingLearningCandidates > 0) {
    needsLines.push(`${plural(needsYou.pendingLearningCandidates, 'learning candidate')} to adopt or reject`);
  }
  if (needsYou.openAsks !== null && needsYou.openAsks > 0) {
    needsLines.push(`${plural(needsYou.openAsks, 'open ask')} — decisions, inputs, credentials`);
  }

  // --- Are we on track ----------------------------------------------------
  const trackLines: string[] = [];
  let status: OnTrackStatus = 'on-track';
  const bump = (to: OnTrackStatus) => {
    if (to === 'off-track' || (to === 'watch' && status === 'on-track')) {
      status = to;
    }
  };
  if (totals.runs > 0 && totals.failed > 0) {
    const rate = Math.round((totals.failed / totals.runs) * 100);
    trackLines.push(`${rate}% of runs failed or went lost (${totals.failed} of ${totals.runs}).`);
    bump(rate >= 25 ? 'off-track' : 'watch');
  }
  const stalled = needsYou.runsAwaitingReview + needsYou.runsPaused;
  if (stalled > 0) {
    trackLines.push(`${plural(stalled, 'run is', 'runs are')} stalled on a person — work is waiting, not moving.`);
    bump('watch');
  }
  for (const m of members) {
    if (m.budgetCents !== null && m.budgetHardCentsLimit && m.budgetHardCentsLimit > 0) {
      const ratio = m.budgetCents / m.budgetHardCentsLimit;
      if (ratio >= 1) {
        trackLines.push(`${m.name} has hit its hard budget cap (${usd(m.budgetCents)} of ${usd(m.budgetHardCentsLimit)}) — new runs will be refused.`);
        bump('off-track');
      } else if (ratio >= BUDGET_WATCH_RATIO) {
        trackLines.push(`${m.name} is at ${Math.round(ratio * 100)}% of its budget cap (${usd(m.budgetCents)} of ${usd(m.budgetHardCentsLimit)}).`);
        bump('watch');
      }
    }
  }
  const heaviest = [...members].sort((a, b) => b.weightPct - a.weightPct)[0];
  if (heaviest && heaviest.weightPct >= 60 && members.length > 1) {
    trackLines.push(`${heaviest.name} carried ${heaviest.weightPct}% of the spend — one role is most of the bill.`);
    bump('watch');
  }
  if (trackLines.length === 0) {
    trackLines.push(totals.runs > 0 ? 'Nothing failed, nothing is stalled, no budget is near its cap.' : 'Nothing ran, so nothing to judge yet.');
  }
  if (perf && !perf.setupNeeded && perf.teamsOnTarget.measured > 0) {
    const missed = perf.teams.filter(t => t.primary && t.primary.value !== null && !t.primary.met);
    if (missed.length > 0) {
      trackLines.push(`${plural(missed.length, 'team is', 'teams are')} under target — ${missed.map(t => t.name).join(', ')}.`);
      bump('watch');
    }
  }

  // --- What happens next --------------------------------------------------
  const next: string[] = [];
  if (needsYou.total > 0) {
    next.push(`Decide the ${plural(needsYou.total, 'item')} in the [inbox](${data.links.inbox}) — that is what unblocks the team.`);
  } else {
    next.push('Nothing is waiting on you; the team keeps running on its schedule.');
  }
  const hours = Math.round((data.window.until.getTime() - data.window.since.getTime()) / 3_600_000);
  next.push(`The next report lands in ${hours} hours. Detail lives in the [team report](${data.links.teamReport}).`);

  // --- Rollup excerpt -----------------------------------------------------
  let rollup: ReportSections['rollup'] = null;
  if (data.rollup) {
    const content = data.rollup.content.trim();
    // A briefing the job was pointed at rides in full; the rollup is excerpted.
    const truncated = !data.rollup.full && content.length > ROLLUP_EXCERPT_CHARS;
    const excerpt = truncated ? `${content.slice(0, ROLLUP_EXCERPT_CHARS).replace(/\s+\S*$/, '')}…` : content;
    rollup = { title: data.rollup.title, publishedAt: `${STAMP_FMT.format(data.rollup.createdAt)} UTC`, excerpt, truncated, label: data.rollup.label };
  }

  // --- Evidence -----------------------------------------------------------
  const evidence = [
    { label: 'Runs', value: `${totals.runs}` },
    { label: 'Completed', value: `${totals.completed}` },
    { label: 'Failed / lost', value: `${totals.failed}` },
    { label: 'Spend', value: usd(totals.cents) },
    { label: 'Tokens', value: compactTokens(totals.tokens) },
    { label: 'Board runs', value: totals.kindsKnown ? `${totals.boardRuns}` : '—' },
    { label: 'Red-team runs', value: totals.kindsKnown ? `${totals.redTeamRuns}` : '—' },
    { label: 'Needs you', value: `${needsYou.total}` },
  ];

  return { performance, changed, needsMe: { total: needsYou.total, lines: needsLines }, onTrack: { status, lines: trackLines }, next, rollup, evidence };
}

const STATUS_LABEL: Record<OnTrackStatus, string> = { 'on-track': 'On track', 'watch': 'Watch', 'off-track': 'Off track' };
const STATUS_COLOR: Record<OnTrackStatus, string> = { 'on-track': '#047857', 'watch': '#b45309', 'off-track': '#b91c1c' };

/**
 * The report as markdown — stored in-app, and the source of the plain-text part.
 * @param data - Collected report data.
 */
export function reportMarkdown(data: DailyTeamReportData): string {
  const s = reportSections(data);
  const lines: string[] = [];
  lines.push(`# ${subjectFor(data)}`);
  lines.push('');
  lines.push(`_${STAMP_FMT.format(data.window.since)} → ${STAMP_FMT.format(data.window.until)} UTC_`);
  lines.push('');
  lines.push('## Performance');
  lines.push('');
  if (s.performance.setup) {
    lines.push(`_${s.performance.setup}_`);
  } else {
    for (const l of s.performance.headline) {
      lines.push(l);
      lines.push('');
    }
    for (const l of s.performance.teams) {
      lines.push(`- ${l}`);
    }
  }
  lines.push('');
  lines.push('## What changed');
  lines.push('');
  for (const l of s.changed) {
    lines.push(`- ${l}`);
  }
  lines.push('');
  lines.push(`## What needs me — ${s.needsMe.total}`);
  lines.push('');
  if (s.needsMe.lines.length === 0) {
    lines.push('_Nothing is waiting on a person._');
  } else {
    for (const l of s.needsMe.lines) {
      lines.push(`- ${l}`);
    }
    lines.push('');
    lines.push(`[Open the inbox](${data.links.inbox})`);
  }
  lines.push('');
  lines.push(`## Are we on track — ${STATUS_LABEL[s.onTrack.status]}`);
  lines.push('');
  for (const l of s.onTrack.lines) {
    lines.push(`- ${l}`);
  }
  lines.push('');
  lines.push('## What happens next');
  lines.push('');
  for (const l of s.next) {
    lines.push(`- ${l}`);
  }
  lines.push('');
  if (s.rollup) {
    lines.push(`## From the ${s.rollup.label}`);
    lines.push('');
    lines.push(`_${s.rollup.title} — ${s.rollup.publishedAt}_`);
    lines.push('');
    // Demote the briefing's own headings so they nest under this section.
    lines.push(s.rollup.excerpt.replace(/^(#{1,4})\s/gm, (_m, h: string) => `${'#'.repeat(Math.min(h.length + 2, 6))} `));
    if (s.rollup.truncated) {
      lines.push('');
      lines.push(`[Read the full briefing](${data.links.briefings})`);
    }
    lines.push('');
  }
  lines.push('## Teams and members');
  lines.push('');
  if (data.teams.length === 0) {
    lines.push('_No agents or runs in this window._');
  }
  for (const team of data.teams) {
    lines.push(`### ${team.name} — ${team.weightPct}% of spend · ${plural(team.runs, 'run')}${team.leadAgentSlug ? ` · lead \`${team.leadAgentSlug}\`` : ''}`);
    lines.push('');
    lines.push('| Member | Done | Failed | Weight | Flags |');
    lines.push('|---|---|---|---|---|');
    for (const m of team.members) {
      lines.push(`| ${m.name} (\`${m.agentSlug}\`) | ${m.completed}/${m.runs} | ${m.failed} | ${m.weightPct}% | ${kindBadges(m) || '—'} |`);
    }
    lines.push('');
  }
  lines.push('## Evidence');
  lines.push('');
  lines.push(s.evidence.map(e => `${e.label} **${e.value}**`).join(' · '));
  lines.push('');
  lines.push('---');
  lines.push(`_Generated ${STAMP_FMT.format(data.generatedAt)} UTC by the \`daily-team-report\` job. [Team report](${data.links.teamReport}) · [Briefings](${data.links.briefings})_`);
  return lines.join('\n');
}

// --- HTML -----------------------------------------------------------------

/**
 * Markdown inline syntax → HTML, for the section lines.
 * @param md - One line of markdown.
 */
function inline(md: string): string {
  return markdownToEmailHtml(md, ST).replace(/^<p style="[^"]*">/, '').replace(/<\/p>$/, '');
}

function h2(text: string, trailing = ''): string {
  return `<h2 style="${ST.h2}">${escapeHtml(text)}${trailing}</h2>`;
}

function bullets(lines: string[]): string {
  return `<ul style="${ST.ul}">${lines.map(l => `<li style="${ST.li}">${inline(l)}</li>`).join('')}</ul>`;
}

function memberRow(m: MemberStats): string {
  const flags = kindBadges(m);
  return `<tr>`
    + `<td style="${ST.td}"><span style="font-weight:600;">${escapeHtml(m.name)}</span> <span style="${MONO}${MUTED}font-size:11px;">${escapeHtml(m.agentSlug)}</span>${flags ? `<br><span style="${MONO}font-size:11px;color:#b45309;">${escapeHtml(flags)}</span>` : ''}</td>`
    + `<td style="${ST.td}text-align:right;">${m.completed}/${m.runs}</td>`
    + `<td style="${ST.td}text-align:right;${m.failed > 0 ? 'color:#b91c1c;font-weight:600;' : ''}">${m.failed}</td>`
    + `<td style="${ST.td}text-align:right;">${weightBar(m.weightPct)}</td>`
    + `</tr>`;
}

function weightBar(pct: number): string {
  const w = Math.max(0, Math.min(100, pct));
  return `<span style="${MONO}font-size:12px;">${pct}%</span>`
    + `<div style="height:4px;background:#e5e7eb;border-radius:2px;margin-top:3px;"><div style="height:4px;width:${w}%;background:#2563eb;border-radius:2px;"></div></div>`;
}

function teamSection(team: TeamStats): string {
  const head = `<h3 style="${ST.h3}">${escapeHtml(team.name)} <span style="${MUTED}font-weight:500;">— ${team.weightPct}% of spend · ${plural(team.runs, 'run')}${team.leadAgentSlug ? ` · lead ${escapeHtml(team.leadAgentSlug)}` : ''}</span></h3>`;
  const th = (t: string, right = false) => `<th style="${ST.th}${right ? 'text-align:right;' : ''}">${t}</th>`;
  return `${head
  }<table role="presentation" cellpadding="0" cellspacing="0" style="${ST.table}">`
  + `<tr>${th('Member')}${th('Done', true)}${th('Failed', true)}${th('Weight', true)}</tr>${
    team.members.map(memberRow).join('')
  }</table>`;
}

function evidenceRow(items: { label: string; value: string }[]): string {
  const cell = (e: { label: string; value: string }) => `<td style="padding:6px 8px;${BORDER}background:#f9fafb;">`
    + `<div style="${FONT}${MUTED}font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(e.label)}</div>`
    + `<div style="${FONT}${INK}font-size:14px;font-weight:600;line-height:1.3;">${escapeHtml(e.value)}</div>`
    + `</td>`;
  const half = Math.ceil(items.length / 2);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0;">`
    + `<tr>${items.slice(0, half).map(cell).join('')}</tr><tr>${items.slice(half).map(cell).join('')}</tr></table>`;
}

export function renderDailyTeamReport(data: DailyTeamReportData): RenderedReport {
  const subject = subjectFor(data);
  const markdown = reportMarkdown(data);
  const s = reportSections(data);

  const needsBadge = ` <span style="${MONO}font-size:13px;color:${s.needsMe.total > 0 ? '#b45309' : '#047857'};">— ${s.needsMe.total}</span>`;
  const trackBadge = ` <span style="${MONO}font-size:13px;color:${STATUS_COLOR[s.onTrack.status]};">— ${STATUS_LABEL[s.onTrack.status]}</span>`;

  const body = [
    `<h1 style="${ST.h1}">${escapeHtml(subject)}</h1>`,
    `<p style="${ST.p}${MUTED}font-size:12px;">${escapeHtml(STAMP_FMT.format(data.window.since))} → ${escapeHtml(STAMP_FMT.format(data.window.until))} UTC</p>`,

    h2('Performance'),
    s.performance.setup
      ? `<p style="${ST.p}${MUTED}">${escapeHtml(s.performance.setup)}</p>`
      : `${s.performance.headline.map(l => `<p style="${ST.p}">${inline(l)}</p>`).join('')}${s.performance.teams.length > 0 ? bullets(s.performance.teams) : ''}`,

    h2('What changed'),
    bullets(s.changed),

    h2('What needs me', needsBadge),
    s.needsMe.lines.length === 0
      ? `<p style="${ST.p}${MUTED}">Nothing is waiting on a person.</p>`
      : `${bullets(s.needsMe.lines)
      }<p style="${ST.p}"><a href="${escapeHtml(data.links.inbox)}" style="${FONT}display:inline-block;background:#1f2328;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px;">Open the inbox → ${s.needsMe.total} waiting</a></p>`,

    h2('Are we on track', trackBadge),
    bullets(s.onTrack.lines),

    h2('What happens next'),
    bullets(s.next),

    s.rollup
      ? `${h2('From the workspace briefing')
      }<p style="${ST.p}${MUTED}font-size:12px;">${escapeHtml(s.rollup.title)} — ${escapeHtml(s.rollup.publishedAt)}</p>`
      + `<div style="padding:10px 14px;${BORDER}border-radius:6px;">${markdownToEmailHtml(s.rollup.excerpt, { ...ST, h1: ST.h3, h2: ST.h3, h3: ST.h3 })}${
        s.rollup.truncated ? `<p style="${ST.p}margin:6px 0 0;"><a href="${escapeHtml(data.links.briefings)}" style="${ST.a}">Read the full briefing</a></p>` : ''
      }</div>`
      : '',

    h2('Teams and members'),
    data.teams.length === 0 ? `<p style="${ST.p}${MUTED}">No agents or runs in this window.</p>` : data.teams.map(teamSection).join(''),

    h2('Evidence'),
    evidenceRow(s.evidence),

    `<hr style="${ST.hr}">`,
    `<p style="${ST.p}${MUTED}font-size:12px;">Generated ${escapeHtml(STAMP_FMT.format(data.generatedAt))} UTC by the <code style="${ST.code}">daily-team-report</code> job for ${escapeHtml(data.workspace.name)}. `
    + `<a href="${escapeHtml(data.links.teamReport)}" style="${ST.a}">Team report</a> · <a href="${escapeHtml(data.links.briefings)}" style="${ST.a}">Briefings</a></p>`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;color-scheme:light dark;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;">
<tr><td align="center" style="padding:20px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;${BORDER}border-radius:8px;">
<tr><td style="padding:22px 22px 18px;">
${body}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text: markdownToPlainText(markdown), markdown };
}
