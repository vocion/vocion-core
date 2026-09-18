/**
 * Rendering a `BriefingV2` — markdown for the stored `briefing.content` and
 * for `get_briefing`, and the mail, which is the first screen and a link.
 *
 * The renderer draws `renderedSections(doc)` and nothing else, so a section
 * with nothing in it produces no heading, no "nothing happened" line and no
 * blank space (`docs/specs/briefing-v2.md` §1). It never re-orders: the order
 * is `BRIEFING_SECTIONS`, which is the order of the spec's information
 * architecture table.
 *
 * Pure — the data carries its own timestamps, so the snapshot test pins the
 * exact output.
 */

import type { BriefingSection, BriefingV2 } from './document';
import { decisionHeadline, firstScreen } from './budget';
import { hasContent, renderedSections, SECTION_TITLE } from './document';
import { formatAmount, formatMetric, metricsLine } from './format';
import { ON_TRACK_LABEL } from './onTrack';

/** Absolute-ish link back to the brief, for the mail. */
export type RenderLinks = { briefing: string; inbox: string; archive: string };

const DEFAULT_LINKS: RenderLinks = { briefing: '/dashboard/briefings', inbox: '/dashboard/inbox', archive: '/dashboard/briefings/archive' };

function stamp(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/**
 * The full document as markdown.
 * @param doc - The document.
 * @param links - Where the links point.
 */
export function renderBriefingMarkdown(doc: BriefingV2, links: RenderLinks = DEFAULT_LINKS): string {
  const out: string[] = [`# ${doc.title}`, '', `${doc.dateLabel} · ${doc.updatedLabel}`, ''];
  const screen = firstScreen(doc);

  for (const section of renderedSections(doc)) {
    out.push(...sectionMarkdown(doc, section, screen, links));
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function sectionMarkdown(doc: BriefingV2, section: BriefingSection, screen: ReturnType<typeof firstScreen>, links: RenderLinks): string[] {
  const out: string[] = [];
  switch (section) {
    case 'today': {
      out.push(`## ${SECTION_TITLE.today}`, '');
      if (screen.metrics.length > 0) {
        out.push(metricsLine(screen.metrics), '');
      }
      if (doc.today?.summary) {
        out.push(doc.today.summary, '');
      }
      const t = doc.today?.onTrack;
      // Only ever said out loud when it is a verdict, or when the person set a
      // target and the system still cannot judge it (spec §3).
      if (t && (t.status !== 'not-enough-evidence' || t.targetSet)) {
        out.push(`**Are we on track:** ${ON_TRACK_LABEL[t.status]}${t.note ? ` — ${t.note}` : ''}`, '');
      }
      break;
    }
    case 'decisions': {
      const d = doc.decisions!;
      const queued = d.queued.batchable + d.queued.background;
      out.push(`## ${SECTION_TITLE.decisions}`, '', `**${decisionHeadline(screen.decisions.length, queued)}**`, '');
      for (const card of screen.decisions) {
        const amount = formatAmount(card.amount, card.currency);
        out.push(`- **[${card.title}](${card.href})**${amount ? ` · ${amount}` : ''} — ${card.whyNow}`);
        if (card.incident && card.incidentReason) {
          out.push(`  - Shown past the usual ${screen.decisions.length - screen.overBudget.length}: ${card.incidentReason}`);
        }
        for (const e of card.evidence) {
          out.push(`  - Evidence: ${e.href ? `[${e.label}](${e.href})` : e.label}`);
        }
      }
      out.push('');
      if (queued > 0) {
        out.push(`[Open the queue](${links.inbox}) — ${d.queued.batchable} safe to batch, ${d.queued.background} background.`, '');
      }
      break;
    }
    case 'changes': {
      out.push(`## ${SECTION_TITLE.changes}`, '');
      for (const c of screen.changes) {
        out.push(`- **${c.label}** ${changeText(c)}${c.narrative ? ` — ${c.narrative}` : ''}`);
      }
      if (screen.foldedChanges.length > 0) {
        out.push('', `<details><summary>${screen.foldedChanges.length} more ${screen.foldedChanges.length === 1 ? 'change' : 'changes'}</summary>`, '');
        for (const c of screen.foldedChanges) {
          out.push(`- **${c.label}** ${changeText(c)}${c.narrative ? ` — ${c.narrative}` : ''}`);
        }
        out.push('', '</details>');
      }
      out.push('');
      break;
    }
    case 'criticalPath': {
      out.push(`## ${SECTION_TITLE.criticalPath}`, '');
      for (const item of [...doc.criticalPath!.items].sort((a, b) => a.order - b.order)) {
        out.push(`- **${item.at}** ${item.label}${item.status ? ` · ${item.status}` : ''}${item.owner ? ` · ${item.owner}` : ''}`);
      }
      out.push('');
      break;
    }
    case 'exceptions': {
      out.push(`## ${SECTION_TITLE.exceptions}`, '');
      for (const e of doc.exceptions!.items) {
        out.push(`- **${e.label}** — ${e.why}${e.owner ? ` (${e.owner})` : ''}`);
      }
      out.push('');
      break;
    }
    case 'detail': {
      out.push(`## ${SECTION_TITLE.detail}`, '', '<details><summary>View full pipeline</summary>', '');
      for (const table of doc.detail!.tables) {
        if (table.rows.length === 0) {
          continue;
        }
        out.push(`### ${table.title}`, '');
        out.push(`| ${table.columns.join(' | ')} |`);
        out.push(`| ${table.columns.map(() => '---').join(' | ')} |`);
        for (const row of table.rows) {
          out.push(`| ${row.join(' | ')} |`);
        }
        if (table.note) {
          out.push('', table.note);
        }
        out.push('');
      }
      out.push('</details>', '');
      break;
    }
    case 'agentActivity': {
      const a = doc.agentActivity!;
      out.push(`## ${SECTION_TITLE.agentActivity}`, '', `<details><summary>${a.summary}</summary>`, '');
      for (const line of a.lines) {
        out.push(`- ${line}`);
      }
      out.push('', '</details>', '');
      break;
    }
    case 'provenance': {
      const p = doc.provenance!;
      out.push(`## ${SECTION_TITLE.provenance}`, '', `<details><summary>${p.sources.length} ${p.sources.length === 1 ? 'source' : 'sources'}</summary>`, '');
      for (const s of p.sources) {
        out.push(`- ${s.href ? `[${s.label}](${s.href})` : s.label}${s.provenance ? ` · ${s.provenance}` : ''}${s.asOf ? ` · ${stamp(s.asOf)}` : ''}${s.detail ? ` — ${s.detail}` : ''}`);
      }
      for (const f of p.footnotes) {
        out.push(`- [${f.marker}] ${f.kind}: \`${f.token}\`${f.note ? ` — ${f.note}` : ''}`);
      }
      if (p.runs) {
        out.push(`- Runs ${p.runs.runs} · failed ${p.runs.failed} · spend $${(p.runs.spendCents / 100).toFixed(2)}`);
      }
      out.push('', '</details>', '');
      break;
    }
    case 'history': {
      const h = doc.history!;
      out.push(`## ${SECTION_TITLE.history}`, '');
      for (const e of h.entries) {
        out.push(`- [${e.title}](${e.href}) · ${stamp(e.at)}`);
      }
      out.push('', `[View all briefings](${h.viewAllHref})${h.total > h.entries.length ? ` — ${h.total} in all` : ''}`, '');
      break;
    }
  }
  return out;
}

function changeText(c: { from: number | string | null; to: number | string | null; unit?: string }): string {
  const side = (v: number | string | null): string => {
    if (v === null) {
      return 'gone';
    }
    return typeof v === 'number' ? formatMetric({ key: '', label: '', value: v, unit: c.unit, provenance: 'observed', evidence: [] }).trim() : v;
  };
  return `${side(c.from)} → ${side(c.to)}`;
}

/**
 * The mail: the first screen only, then a link (spec §"first screen").
 *
 * Deliberately NOT the whole document. The mail is the same editorial layer,
 * shorter: title, date, the metrics line, the cards that need a person, what
 * changed, today's clock — and "Open the full briefing". Sections 6 to 9 have
 * no place in an inbox.
 * @param doc - The document.
 * @param links - Where the links point (absolute URLs for mail).
 */
export function renderBriefingEmailMarkdown(doc: BriefingV2, links: RenderLinks = DEFAULT_LINKS): string {
  const screen = firstScreen(doc);
  const out: string[] = [`# ${doc.title}`, '', `${doc.dateLabel} · ${doc.updatedLabel}`, ''];

  if (screen.metrics.length > 0) {
    out.push(metricsLine(screen.metrics), '');
  }
  if (doc.today?.summary) {
    out.push(doc.today.summary, '');
  }

  if (hasContent(doc, 'decisions')) {
    const queued = doc.decisions!.queued.batchable + doc.decisions!.queued.background;
    out.push(`## ${SECTION_TITLE.decisions}`, '', `**${decisionHeadline(screen.decisions.length, queued)}**`, '');
    for (const card of screen.decisions) {
      const amount = formatAmount(card.amount, card.currency);
      out.push(`- **[${card.title}](${card.href})**${amount ? ` · ${amount}` : ''} — ${card.whyNow}`);
    }
    out.push('');
  }

  if (screen.changes.length > 0) {
    out.push(`## ${SECTION_TITLE.changes}`, '');
    for (const c of screen.changes) {
      out.push(`- **${c.label}** ${changeText(c)}${c.narrative ? ` — ${c.narrative}` : ''}`);
    }
    out.push('');
  }

  if (screen.criticalPath.length > 0) {
    out.push(`## ${SECTION_TITLE.criticalPath}`, '');
    out.push([...screen.criticalPath].sort((a, b) => a.order - b.order).map(i => `${i.at} ${i.label}${i.status ? ` · ${i.status}` : ''}`).join(' · '), '');
  }

  out.push(`[Open the full briefing](${links.briefing})`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * The mail subject — the brief's own title, which already carries the date.
 * @param doc - The document.
 */
export function briefingSubject(doc: BriefingV2): string {
  return doc.title;
}
