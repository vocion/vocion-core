/**
 * The feature page's drawers — everything a section summarises, in full.
 *
 * The page shows a sentence per stage; the whole record of each stage opens
 * in the preview pane as `feature_section:<requestId>.<key>`
 * (`services/preview/descriptors.ts`). One pane, the same one every other
 * peek uses: a side panel at a desk, a bottom sheet on a phone, linkable,
 * closed by Back, never stacked (principle 6).
 *
 * EACH THING SAID ONCE (Chris, 2026-09-28, on #126: "what should be on this
 * preview pane?"). The pane's header already carries the title, so a drawer
 * never prints it again; its one line under the title is the status, so the
 * facts and the body never repeat it; a reason is listed where it is named,
 * never "listed below"; and every reference is a link in words to the thing
 * itself — a run, the plan record, the pull request — never a bare id.
 *
 * Pure: a report in, the pane's content out, so what a drawer says is tested
 * from fixtures (`featureDrawer.test.ts`). What a drawer leaves out is one
 * link away: the plan record, the run page, the release.
 */

import type { FeatureDrawerKey, FeatureReport, ReportAttempt, ReportCheck, ReportEntry, ReportSection, TimelineEntry } from './featureReport';
import { formatAge, formatStamp, money } from './featureReport';

/** What a drawer shows: the pane's heading, one line under it, a few facts and the body. */
export type FeatureDrawer = {
  title: string;
  subtitle?: string;
  facts?: Array<{ label: string; value: string }>;
  body: string;
  /** The full page of what this drawer summarises (the plan record, the latest run), for the pane's link out. */
  href?: string;
};

const DRAWER_KEY = /^(?:status|plan|implementation|acceptance|release|activity|work|cost|details|criterion-\d+)$/;

/**
 * Read `<requestId>.<key>` back into its parts, or null for anything else.
 * @param id - The preview ref's id.
 */
export function parseFeatureDrawerId(id: string): { requestId: number; key: FeatureDrawerKey } | null {
  const m = /^(\d+)\.([\w-]+)$/.exec(id);
  if (!m || !DRAWER_KEY.test(m[2]!)) {
    return null;
  }
  const requestId = Number(m[1]);
  return Number.isSafeInteger(requestId) && requestId > 0 ? { requestId, key: m[2] as FeatureDrawerKey } : null;
}

/**
 * The preview id for one drawer.
 * @param requestId - The request.
 * @param key - The drawer.
 */
export function featureDrawerId(requestId: number, key: FeatureDrawerKey): string {
  return `${requestId}.${key}`;
}

/** Empty-looking values the page leaves out; a drawer does too. */
const EMPTY = /^(?:not recorded|nobody(?: yet)?|none|n\/a|—|-)$/i;

/**
 * A preview link a person can follow inside the pane: the same page, another peek.
 * @param type - The record type.
 * @param id - Its id.
 */
function peek(type: string, id: number | string): string {
  return `?preview=${type}:${id}`;
}

/**
 * An engineering run's own page.
 * @param runId - The run.
 */
function runPage(runId: number): string {
  return `/dashboard/p/runs/${runId}`;
}

/**
 * A pull request as words: `northwind-portal#12`, else the link as it is.
 * @param url - The pull request URL.
 */
function prName(url: string): string {
  const m = /github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url;
}

/**
 * Clauses as one sentence: "a", "a and b", "a; b; and c".
 * @param items - The clauses.
 */
function joinClauses(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? '';
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join('; ')}; and ${items.at(-1)}`;
}

/**
 * An evidence link as a peek when it names something the pane can show (an
 * artifact, a run), so opening the evidence swaps the pane rather than
 * leaving the page. Anything else stays the link it is.
 * @param url - The recorded evidence URL.
 */
export function evidenceHref(url: string): string {
  const artifact = /^\/dashboard\/artifacts\/(\d+)\/?$/.exec(url);
  if (artifact) {
    return peek('artifact', artifact[1]!);
  }
  const run = /^\/(?:dashboard\/p\/)?runs\/(\d+)\/?$/.exec(url);
  return run ? peek('worker_run', run[1]!) : url;
}

/**
 * One report entry as markdown: heading, its steps, facts, checks and flags.
 * @param e - The entry.
 */
function entryMd(e: ReportEntry): string {
  const head = `### ${e.title}${e.status ? ` · ${e.status}` : ''}`;
  const stamp = e.at ? `_${formatStamp(e.at)}${e.cents !== null ? ` · ${money(e.cents)}` : ''}_` : null;
  const steps = (e.steps ?? []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const facts = [...e.facts, ...(e.detailFacts ?? [])]
    .filter(f => f.value !== null && !EMPTY.test(f.value.trim()))
    .map(f => (f.format === 'quote' ? `**${f.label}**\n\n> ${f.value!.replace(/\n/g, '\n> ')}` : `- **${f.label}:** ${f.href ? `[${f.value}](${f.href})` : f.value}`))
    .join('\n');
  const checks = e.checks.map(c => `- ${c.name}: ${c.passed === true ? 'passed' : c.passed === false ? 'failed' : 'not run'}${c.detail ? ` (${c.detail})` : ''}`).join('\n');
  const flags = e.flags.map(f => `> ${f}`).join('\n\n');
  return [head, stamp, steps, facts, checks ? `**Checks**\n\n${checks}` : '', flags].filter(Boolean).join('\n\n');
}

/**
 * A whole section as markdown.
 * @param s - The section.
 * @param opts - What to leave out because the drawer already says it.
 * @param opts.heading - Whether to print the section's own title.
 * @param opts.absence - Whether to print the "it did not happen" sentence.
 * @param opts.omit - Fact labels the drawer already carries.
 */
function sectionMd(s: ReportSection | undefined, opts: { heading?: boolean; absence?: boolean; omit?: readonly string[] } = {}): string {
  if (!s) {
    return '';
  }
  const { heading = true, absence = true, omit = [] } = opts;
  const parts: string[] = [];
  if (heading) {
    parts.push(`## ${s.title}`);
  }
  if (s.absence && absence) {
    parts.push(s.absence);
  }
  const facts = s.facts.filter(f => f.value !== null && !EMPTY.test(f.value.trim()) && !omit.includes(f.label));
  if (facts.length > 0) {
    parts.push(facts.map(f => (f.format === 'quote' ? `**${f.label}**\n\n> ${f.value!.replace(/\n/g, '\n> ')}` : `- **${f.label}:** ${f.href ? `[${f.value}](${f.href})` : f.value}`)).join('\n'));
  }
  for (const e of s.entries) {
    parts.push(entryMd(e));
  }
  for (const l of [...s.lists, ...s.detailLists]) {
    parts.push(`**${l.label}**\n\n${l.items.map(i => `- ${i}`).join('\n')}`);
  }
  if (s.checks.length > 0) {
    parts.push(s.checks.map(c => `- ${c.name}: ${c.passed === true ? 'passed' : c.passed === false ? 'failed' : 'not checked'}`).join('\n'));
  }
  for (const ev of s.evidence) {
    parts.push(`- ${ev.title}${ev.url ? ` — [open](${ev.url})` : ''}${ev.caption ? `: ${ev.caption}` : ''}`);
  }
  for (const f of s.flags) {
    parts.push(`> ${f}`);
  }
  return parts.length === (heading ? 1 : 0) ? '' : parts.join('\n\n');
}

/**
 * One timeline entry as a line. A run links to its page, which the timeline
 * itself does not carry.
 * @param e - The entry.
 */
function timelineLine(e: TimelineEntry): string {
  const runId = e.kind === 'run' ? /^run-(\d+)$/.exec(e.key)?.[1] : undefined;
  const href = e.href ?? (runId ? runPage(Number(runId)) : null);
  // A pull request reads as `repo#12`, not as its URL spelled out.
  const words = e.title.replace(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/g, prName);
  const title = href ? `[${words}](${href})` : words;
  return `- **${formatStamp(e.at)}**${e.cents !== null ? ` · ${money(e.cents)}` : ''} — ${title}${e.detail ? `\n  ${e.detail.replace(/\s+/g, ' ').slice(0, 280)}` : ''}`;
}

/**
 * What an attempt's checks reported, in one clause.
 * @param checks - The checks.
 */
function checksLine(checks: ReportCheck[]): string {
  if (checks.length === 0 || checks.every(c => c.passed === null)) {
    return 'none reported';
  }
  const failed = checks.filter(c => c.passed === false).map(c => c.name);
  const passed = checks.filter(c => c.passed === true).length;
  return [
    failed.length > 0 ? `${failed.length} failed (${failed.join(', ')})` : null,
    passed > 0 ? `${passed} passed` : null,
  ].filter(Boolean).join(', ');
}

/**
 * One attempt: its outcome as a link to its run page, then the PR, the
 * checks and why it stopped.
 * @param a - The attempt.
 * @param n - Its number, oldest = 1.
 */
function attemptMd(a: ReportAttempt, n: number): string {
  const head = `**[Attempt ${n} · ${a.outcome}](${runPage(a.runId)})** · ${formatStamp(a.at)}${a.cents !== null ? ` · ${money(a.cents)}` : ''}`;
  const lines = [
    a.prUrl ? `- Pull request: [${prName(a.prUrl)}](${a.prUrl})` : null,
    a.executed ? `- Checks: ${checksLine(a.checks)}` : null,
    a.why && a.outcome !== 'Completed' ? `- Why it stopped: ${a.why}` : null,
  ].filter(Boolean);
  return [head, ...lines].join('\n');
}

/**
 * The drawer for one key, or null when the key names nothing on this report
 * (a criterion past the end of the list).
 * @param report - The assembled report.
 * @param key - Which drawer.
 * @param now - The clock, for "2 days ago".
 */
export function featureDrawer(report: FeatureReport, key: FeatureDrawerKey, now: Date = new Date()): FeatureDrawer | null {
  const section = (k: string) => report.sections.find(s => s.key === k);
  const ago = (d: Date) => formatAge(now.getTime() - d.getTime());
  const self = (k: FeatureDrawerKey) => peek('feature_section', featureDrawerId(report.requestId, k));
  switch (key) {
    case 'status': {
      const notices = report.notices.map(n => `### ${n.known}\n\n${n.blocks}\n\n> As recorded: ${n.evidence}`).join('\n\n');
      return {
        title: 'Delivery status',
        subtitle: report.status.sentence,
        body: [
          report.state.question ? `**On the record:** ${report.state.question}` : '',
          notices ? `## What the records disagree about\n\nNothing here was resolved for you: both facts are shown as recorded.\n\n${notices}` : '',
          `## Stage\n\n${report.lifecycle.map(s => `- ${s.label}: ${s.state === 'done' ? 'done' : s.state === 'now' ? '**now**' : 'not yet'}`).join('\n')}`,
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'plan': {
      const p = report.planSummary;
      // ONE status line: where the plan stands, who decided, when.
      const statusLine = p.status === null
        ? p.absence ?? 'No plan yet.'
        : [
            p.status === 'Approved' && p.approver ? `Approved by ${p.approver}` : p.status,
            p.approvedAt ? formatStamp(p.approvedAt) : null,
          ].filter(Boolean).join(' · ');
      // ONE sentence on why a plan was needed, with the reasons in it.
      const why = p.reasons.length > 0
        ? `A plan was required because ${joinClauses(p.reasons)}.`
        : p.requirement?.startsWith('Optional')
          ? 'A plan was optional here; it could be skipped with a written reason.'
          : p.requirement === 'No' ? 'The plan rule did not require one.' : '';
      const record = p.href;
      return {
        title: 'Plan',
        subtitle: statusLine,
        body: p.planId === null
          ? why
          : [
              why,
              p.approach ? `## Approach\n\n${p.approach}` : '',
              `## What changes\n\n${p.components.length > 0 ? p.components.map((c, i) => `${i + 1}. ${c}`).join('\n') : 'The plan names no components.'}`,
              `## Risks\n\n${p.risks.length > 0 ? p.risks.map(r => `- ${r}`).join('\n') : 'The plan names no risks.'}`,
              `[Open the plan record](${record})`,
            ].filter(Boolean).join('\n\n'),
        ...(record ? { href: record } : {}),
      };
    }
    case 'implementation': {
      const impl = report.implementation;
      const n = impl.attempts.length;
      const attempts = impl.attempts.map((a, i) => attemptMd(a, n - i)).join('\n\n');
      const latest = impl.latest ? runPage(impl.latest.runId) : null;
      // The five delivery facts, each a link to what it rests on.
      const evidence: Record<string, string | null> = {
        run: latest,
        checks: latest,
        merged: impl.prUrl,
        acceptance: self('acceptance'),
        released: report.release.href ?? self('release'),
      };
      const ladder = impl.ladder
        .map((s) => {
          const href = evidence[s.key];
          return `- **${s.label}:** ${href ? `[${s.value}](${href})` : s.value}`;
        })
        .join('\n');
      const files = (section('change')?.lists ?? []).map(l => `**${l.label}**\n\n${l.items.map(i => `- ${i}`).join('\n')}`).join('\n\n');
      return {
        title: 'Implementation',
        subtitle: n === 0 ? impl.absence ?? undefined : `${n} attempt${n === 1 ? '' : 's'} · ${impl.costLine}`,
        body: [
          attempts ? `## Attempts, newest first\n\n${attempts}` : '',
          `## Where it stands\n\n${ladder}`,
          files,
        ].filter(Boolean).join('\n\n'),
        ...(latest ? { href: latest } : {}),
      };
    }
    case 'acceptance': {
      const a = report.acceptance;
      const word = { passed: 'Passed', failed: 'Failed', unverified: 'Unverified' } as const;
      const line = (c: typeof a.items[number], i: number) => `${i + 1}. **${word[c.state]}** — ${c.statement}${c.evidenceUrl ? ` ([evidence](${evidenceHref(c.evidenceUrl)}))` : ''}${c.note ? `\n   _${c.note}_` : ''}`;
      const items = a.items.map(line).join('\n');
      const risks = a.risks.map((c, i) => line(c, a.items.length + i)).join('\n');
      const attempt = a.attempt ? `Judged on task ${a.attempt.taskId}, ${a.attempt.why === 'shipped' ? 'the attempt that shipped' : 'the newest attempt QA judged'}.` : '';
      const verdict = report.state.key === 'changes' ? `## What QA asked for\n\n${report.state.detail}` : '';
      return {
        title: 'Acceptance',
        subtitle: a.total === 0 ? 'Nothing says what done means for this work yet.' : `${a.verified} of ${a.total} verified${a.risksLine ? ` · ${a.risksLine}` : ''}${a.source === 'task' ? ' · criteria from the engineering task' : ''}${a.frozenAt === null && a.source === 'request' ? ' · still a draft' : ''}`,
        body: [
          verdict,
          attempt,
          items ? `## Criteria\n\n${items}` : '',
          risks ? `## Plan risks · ${a.risksLine}\n\n${risks}` : '',
          a.procedure ? `## How it is reviewed\n\n${a.procedure}` : '## How it is reviewed\n\nNo review procedure is written for this work.',
          sectionMd(section('qa')),
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'release': {
      const r = report.release;
      const internal = r.href?.startsWith('/') ? r.href : undefined;
      return {
        title: 'Release',
        // The sentence carries the state and the date; nothing below repeats it.
        subtitle: r.sentence,
        body: [
          r.href ? `[${r.state === 'live' ? 'Open it where it runs' : 'Open the release record'}](${r.href})` : '',
          sectionMd(section('release'), { heading: false, absence: false }),
          sectionMd(section('result')),
        ].filter(Boolean).join('\n\n'),
        ...(internal ? { href: internal } : {}),
      };
    }
    case 'activity':
      return {
        title: 'Activity',
        subtitle: `${report.timeline.length} event${report.timeline.length === 1 ? '' : 's'}, oldest first`,
        body: report.timeline.length === 0 ? 'Nothing on this work is dated, so there is no order to show.' : report.timeline.map(timelineLine).join('\n'),
      };
    case 'work': {
      const items = report.activity ?? [];
      const word = { conversation: 'Conversation', mission_run: 'Agent run', worker_run: 'Engineering run' } as const;
      const conversations = items.filter(i => i.kind === 'conversation').length;
      const runs = items.length - conversations;
      const count = [
        conversations > 0 ? `${conversations} conversation${conversations === 1 ? '' : 's'}` : null,
        runs > 0 ? `${runs} run${runs === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' and ');
      return {
        title: 'Connected work',
        subtitle: items.length === 0 ? undefined : `${count} tied to this work, newest first`,
        body: items.length === 0
          ? 'No conversation or run names this work.'
          : items.map((i) => {
              // A run with no title of its own reads as what it is, with its number.
              const title = /^(?:Mission|Agent) run \d+$/.test(i.title) ? `${word[i.kind]} #${i.id}` : i.title;
              return `- [${title}](${peek(i.kind, i.id)}) · ${word[i.kind]}${i.status ? ` · ${i.status}` : ''}${i.detail ? ` · ${i.detail}` : ''} · ${ago(i.at)}`;
            }).join('\n'),
      };
    }
    case 'cost': {
      const impl = report.implementation;
      const n = impl.attempts.length;
      return {
        title: 'Cost',
        subtitle: impl.costLine,
        body: [
          // The spend is the line above; the working behind it is what is left.
          sectionMd(section('money'), { heading: false, omit: ['Spent'] }),
          report.notices.filter(nt => nt.key === 'cost-disagree').map(nt => `> ${nt.evidence}`).join('\n\n'),
          n > 0
            ? `## By attempt\n\n${impl.attempts.map((a, i) => `- [Attempt ${n - i} · ${a.outcome}](${runPage(a.runId)}): ${a.cents === null ? 'no charge recorded' : money(a.cents)}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'details':
      return {
        title: 'The records',
        subtitle: 'The ask as written, triage, the contracts and the approvals.',
        facts: [
          { label: 'Asked', value: report.summary.askedAt ? formatStamp(report.summary.askedAt) : 'not recorded' },
          { label: 'Shipped', value: report.summary.shippedAt ? formatStamp(report.summary.shippedAt) : 'nothing has shipped' },
          { label: 'Elapsed', value: report.summary.elapsed === null ? 'not measurable' : report.summary.elapsedOpen ? `${report.summary.elapsed} so far` : report.summary.elapsed },
          { label: 'Total cost', value: money(report.summary.totalCents) },
          { label: 'Human decisions', value: report.summary.humanDecisions === null ? 'not linked' : String(report.summary.humanDecisions) },
          { label: 'Attempts', value: report.summary.attempts === null ? 'not linked' : String(report.summary.attempts) },
        ],
        // "Asked" is a fact above; the ask's own section does not say it again.
        body: ['ask', 'triage', 'contract', 'approvals', 'today', 'visuals'].map(k => sectionMd(section(k), { omit: ['Asked'] })).filter(Boolean).join('\n\n'),
      };
    default: {
      const n = Number(/^criterion-(\d+)$/.exec(key)?.[1]);
      const c = Number.isInteger(n) ? [...report.acceptance.items, ...report.acceptance.risks][n] : undefined;
      if (!c) {
        return null;
      }
      const word = c.state === 'passed' ? 'Passed' : c.state === 'failed' ? 'Failed' : 'Unverified';
      return {
        title: `Criterion ${n + 1} · ${word}`,
        subtitle: c.statement,
        body: [
          c.evidenceUrl ? `**Evidence:** [open it](${evidenceHref(c.evidenceUrl)})` : c.evidence ? '' : 'No evidence is attached to this criterion, so it cannot read as passed.',
          c.evidence ? `> ${c.evidence}` : '',
          report.acceptance.attempt && c.from === 'verdict' ? `_From task ${report.acceptance.attempt.taskId}'s QA verdict (${report.acceptance.attempt.why === 'shipped' ? 'the attempt that shipped' : 'the newest judged attempt'})._` : '',
          c.note ? `_${c.note}_` : '',
          report.acceptance.procedure ? `## How it is reviewed\n\n${report.acceptance.procedure}` : '',
        ].filter(Boolean).join('\n\n'),
      };
    }
  }
}
