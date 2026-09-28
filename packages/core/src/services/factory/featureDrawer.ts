/**
 * The feature page's drawers — everything a section summarises, in full.
 *
 * The page shows a sentence per stage; the whole record of each stage opens
 * in the preview pane as `feature_section:<requestId>.<key>`
 * (`services/preview/descriptors.ts`). One pane, the same one every other
 * peek uses: a side panel at a desk, a bottom sheet on a phone, linkable,
 * closed by Back, never stacked (principle 6).
 *
 * Pure: a report in, the pane's content out, so what a drawer says is tested
 * from fixtures (`featureDrawer.test.ts`). Nothing is dropped on the way to a
 * drawer — every section the report assembles is reachable from one.
 */

import type { FeatureDrawerKey, FeatureReport, ReportEntry, ReportSection, TimelineEntry } from './featureReport';
import { formatAge, formatStamp, money } from './featureReport';

/** What a drawer shows: the pane's heading, one line under it, a few facts and the body. */
export type FeatureDrawer = {
  title: string;
  subtitle?: string;
  facts?: Array<{ label: string; value: string }>;
  body: string;
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
 * A whole section as markdown, nothing left out.
 * @param s - The section.
 * @param heading - Whether to print the section's own title.
 */
function sectionMd(s: ReportSection | undefined, heading = true): string {
  if (!s) {
    return '';
  }
  const parts: string[] = [];
  if (heading) {
    parts.push(`## ${s.title}`);
  }
  if (s.absence) {
    parts.push(s.absence);
  }
  const facts = s.facts.filter(f => f.value !== null && !EMPTY.test(f.value.trim()));
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
  return parts.join('\n\n');
}

/**
 * One timeline entry as a line.
 * @param e - The entry.
 */
function timelineLine(e: TimelineEntry): string {
  const title = e.href ? `[${e.title}](${e.href})` : e.title;
  return `- **${formatStamp(e.at)}**${e.cents !== null ? ` · ${money(e.cents)}` : ''} — ${title}${e.detail ? `\n  ${e.detail.replace(/\s+/g, ' ').slice(0, 280)}` : ''}`;
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
  const name = report.title;
  switch (key) {
    case 'status': {
      const notices = report.notices.map(n => `### ${n.known}\n\n${n.blocks}\n\n> As recorded: ${n.evidence}`).join('\n\n');
      return {
        title: `Delivery status · ${name}`,
        subtitle: report.status.sentence,
        facts: report.implementation.ladder.map(s => ({ label: s.label, value: s.value })),
        body: [
          `**Where it is:** ${report.status.headline}.`,
          report.state.question ? `**On the record:** ${report.state.question}` : '',
          notices ? `## What the records disagree about\n\nNothing here was resolved for you: both facts are shown as recorded.\n\n${notices}` : 'The records agree with each other.',
          `## Stage\n\n${report.lifecycle.map(s => `- ${s.label}: ${s.state === 'done' ? 'done' : s.state === 'now' ? '**now**' : 'not yet'}`).join('\n')}`,
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'plan': {
      const p = report.planSummary;
      const approvals = [
        ...report.timeline.filter(e => e.kind === 'plan' || e.kind === 'decision').map(timelineLine),
      ];
      return {
        title: `Plan · ${name}`,
        subtitle: p.scope ?? p.absence ?? undefined,
        facts: [
          p.status && { label: 'Status', value: p.status },
          p.approver && { label: 'Approved by', value: p.approver },
          p.approvedAt && { label: 'Approved', value: formatStamp(p.approvedAt) },
          p.requirement && { label: 'Was a plan needed?', value: p.requirement },
        ].filter((f): f is { label: string; value: string } => Boolean(f)),
        body: [
          sectionMd(section('plan'), false),
          approvals.length > 0 ? `## Approval history\n\n${approvals.join('\n')}` : '## Approval history\n\nNo approval is on the record.',
          sectionMd(section('contract')),
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'implementation': {
      const impl = report.implementation;
      const runs = section('runs');
      const attempts = (runs?.entries ?? []).map(e => `${entryMd(e)}\n\n[Open this run](${peek('worker_run', e.key.replace(/^run-/, ''))})`).join('\n\n---\n\n');
      return {
        title: `Implementation · ${name}`,
        subtitle: impl.latest
          ? `Latest run · ${impl.latest.outcome} · ${ago(impl.latest.at)}${impl.latest.cents !== null ? ` · ${money(impl.latest.cents)}` : ''}${impl.earlier > 0 ? ` · ${impl.earlier} earlier attempt${impl.earlier === 1 ? '' : 's'}` : ''}`
          : impl.absence ?? undefined,
        facts: [
          ...impl.ladder.map(s => ({ label: s.label, value: s.value })),
          { label: 'Cost', value: impl.costLine },
        ],
        body: [
          impl.prUrl ? `**Pull request:** [${impl.prUrl}](${impl.prUrl})` : '',
          attempts ? `## Attempts, newest first\n\n${attempts}` : '',
          sectionMd(section('change')),
          sectionMd(section('money')),
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'acceptance': {
      const a = report.acceptance;
      const word = { passed: 'Passed', failed: 'Failed', unverified: 'Unverified' } as const;
      const items = a.items.map((c, i) => `${i + 1}. **${word[c.state]}** — ${c.statement}${c.evidenceUrl ? ` ([evidence](${evidenceHref(c.evidenceUrl)}))` : ''}${c.note ? `\n   _${c.note}_` : ''}`).join('\n');
      const verdict = report.state.key === 'changes' ? `## What QA asked for\n\n${report.state.detail}` : '';
      return {
        title: `Acceptance · ${name}`,
        subtitle: a.total === 0 ? 'Nothing says what done means for this work yet.' : `${a.verified} of ${a.total} verified${a.source === 'task' ? ' · criteria from the engineering task' : ''}${a.frozenAt === null && a.source === 'request' ? ' · still a draft' : ''}`,
        body: [
          verdict,
          items ? `## Criteria\n\n${items}` : '',
          a.procedure ? `## How it is reviewed\n\n${a.procedure}` : '## How it is reviewed\n\nNo review procedure is written for this work.',
          sectionMd(section('qa')),
          sectionMd(section('result')),
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'release': {
      const r = report.release;
      return {
        title: `Release · ${name}`,
        subtitle: r.sentence,
        facts: [{ label: 'Release', value: r.label }, ...(r.at ? [{ label: 'Shipped', value: formatStamp(r.at) }] : [])],
        body: [
          r.href ? `[Open it](${r.href})` : '',
          sectionMd(section('release'), false),
          sectionMd(section('result')),
        ].filter(Boolean).join('\n\n'),
      };
    }
    case 'activity':
      return {
        title: `Activity · ${name}`,
        subtitle: `${report.timeline.length} event${report.timeline.length === 1 ? '' : 's'}, oldest first`,
        body: report.timeline.length === 0 ? 'Nothing on this work is dated, so there is no order to show.' : report.timeline.map(timelineLine).join('\n'),
      };
    case 'work': {
      const items = report.activity ?? [];
      const word = { conversation: 'Conversation', mission_run: 'Agent run', worker_run: 'Engineering run' } as const;
      return {
        title: `Connected work · ${name}`,
        subtitle: `${items.length} conversation${items.length === 1 ? '' : 's'} and runs tied to this work, newest first`,
        body: items.length === 0
          ? 'No conversation or run names this work.'
          : items.map(i => `- [${i.title}](${peek(i.kind, i.id)}) · ${word[i.kind]}${i.status ? ` · ${i.status}` : ''}${i.detail ? ` · ${i.detail}` : ''} · ${ago(i.at)}`).join('\n'),
      };
    }
    case 'cost':
      return {
        title: `Cost · ${name}`,
        subtitle: report.implementation.costLine,
        body: [
          sectionMd(section('money'), false),
          report.notices.filter(n => n.key === 'cost-disagree').map(n => `> ${n.evidence}`).join('\n\n'),
          (section('runs')?.entries ?? []).length > 0
            ? `## By run\n\n${section('runs')!.entries.map(e => `- ${e.title}: ${e.cents === null ? 'no charge recorded' : money(e.cents)}`).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n'),
      };
    case 'details':
      return {
        title: `The records · ${name}`,
        subtitle: 'The ask as written, triage, the contracts and the approvals.',
        facts: [
          { label: 'Asked', value: report.summary.askedAt ? formatStamp(report.summary.askedAt) : 'not recorded' },
          { label: 'Shipped', value: report.summary.shippedAt ? formatStamp(report.summary.shippedAt) : 'nothing has shipped' },
          { label: 'Elapsed', value: report.summary.elapsed === null ? 'not measurable' : report.summary.elapsedOpen ? `${report.summary.elapsed} so far` : report.summary.elapsed },
          { label: 'Total cost', value: money(report.summary.totalCents) },
          { label: 'Human decisions', value: report.summary.humanDecisions === null ? 'not linked' : String(report.summary.humanDecisions) },
          { label: 'Attempts', value: report.summary.attempts === null ? 'not linked' : String(report.summary.attempts) },
        ],
        body: ['ask', 'triage', 'contract', 'approvals', 'today', 'visuals'].map(k => sectionMd(section(k))).filter(Boolean).join('\n\n'),
      };
    default: {
      const n = Number(/^criterion-(\d+)$/.exec(key)?.[1]);
      const c = Number.isInteger(n) ? report.acceptance.items[n] : undefined;
      if (!c) {
        return null;
      }
      const word = c.state === 'passed' ? 'Passed' : c.state === 'failed' ? 'Failed' : 'Unverified';
      return {
        title: `Criterion ${n + 1} · ${word}`,
        subtitle: c.statement,
        body: [
          c.evidenceUrl ? `**Evidence:** [open it](${evidenceHref(c.evidenceUrl)})` : 'No evidence is attached to this criterion, so it cannot read as passed.',
          c.note ? `_${c.note}_` : '',
          report.acceptance.procedure ? `## How it is reviewed\n\n${report.acceptance.procedure}` : '',
        ].filter(Boolean).join('\n\n'),
      };
    }
  }
}
