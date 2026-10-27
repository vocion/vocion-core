/**
 * The SERP brief: Google's top pages for a query, compared, as one markdown
 * artifact (folder `seo/serp`). Every row links to its page and carries the
 * dates the page states; the header carries when and how the results page
 * was read (design principle 10). Pure, so it is tested on fixtures.
 *
 * The synthesis (intent, common subtopics, gaps) is the agent's to write,
 * from these facts, and lands between two markers so writing it never
 * rewrites the evidence above it (`withSynthesis`).
 */

import type { PageFacts } from './pageFacts';
import type { SerpResult } from './types';

/** One compared page: its rank on the results page and what was read off it. */
export type ComparedPage = {
  position: number;
  url: string;
  domain: string;
  /** The title Google showed. */
  serpTitle: string;
  /** The date Google showed beside it, when it showed one. */
  serpDate?: string;
  facts: PageFacts | null;
  /** Why the page could not be read, when it could not. */
  error?: string;
};

/** A synthesis point, cited by the positions of the pages that support it. */
export type SynthesisPoint = { point: string; sources: number[] };

export type Synthesis = {
  intent: string;
  commonSubtopics: SynthesisPoint[];
  gaps: SynthesisPoint[];
};

export const SYNTHESIS_START = '<!-- serp-synthesis -->';
export const SYNTHESIS_END = '<!-- /serp-synthesis -->';

/** The artifacts-log folder every SERP brief is filed under. */
export const SERP_BRIEF_FOLDER = 'seo/serp';

function cell(text: string | number | null | undefined): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function linkText(text: string): string {
  return cell(text).replace(/[[\]]/g, '');
}

function day(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return iso ? iso[0] : value;
}

/**
 * "2026-10-27 14:05 UTC"
 * @param iso - An ISO timestamp.
 */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * A heading reduced to what it says: case, numbering and punctuation gone.
 * @param text - The heading.
 */
export function headingKey(text: string): string {
  return text.toLowerCase().replace(/^[\d.)\s-]+/, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * H2/H3 headings that two or more of the pages share, most-shared first, with
 * the positions of the pages that have them.
 * @param pages - The compared pages.
 * @param limit - How many to keep.
 */
export function recurringHeadings(pages: ComparedPage[], limit = 15): Array<{ heading: string; positions: number[] }> {
  const seen = new Map<string, { heading: string; positions: Set<number> }>();
  for (const page of pages) {
    for (const h of page.facts?.outline ?? []) {
      if (h.level === 1) {
        continue;
      }
      const key = headingKey(h.text);
      if (key.length < 3) {
        continue;
      }
      const entry = seen.get(key) ?? { heading: h.text.replace(/^[\d.)\s-]+/, ''), positions: new Set<number>() };
      entry.positions.add(page.position);
      seen.set(key, entry);
    }
  }
  return [...seen.values()]
    .filter(e => e.positions.size >= 2)
    .sort((a, b) => b.positions.size - a.positions.size || a.heading.localeCompare(b.heading))
    .slice(0, limit)
    .map(e => ({ heading: e.heading, positions: [...e.positions].sort((a, b) => a - b) }));
}

function cite(positions: number[], pages: ComparedPage[]): string {
  return positions
    .map(p => pages.find(x => x.position === p))
    .filter((p): p is ComparedPage => Boolean(p))
    .map(p => `[#${p.position}](${p.url})`)
    .join(' ');
}

/**
 * The brief's markdown.
 * @param serp - The results page it compares.
 * @param pages - The pages read, in rank order.
 */
export function renderSerpBrief(serp: SerpResult, pages: ComparedPage[]): string {
  const where = [serp.location, serp.language && `language ${serp.language}`, serp.country && `country ${serp.country.toUpperCase()}`, serp.device].filter(Boolean).join(' · ');
  const source = serp.isGoogleRanking ? `Google's results page, read through ${serp.provider}` : `${serp.provider.replace(/^web_search:/, '')} web search (not Google)`;
  const lines: string[] = [
    `# SERP brief: ${serp.query}`,
    '',
    `Top ${pages.length} for **${cell(serp.query)}**${where ? ` · ${where}` : ''} · read ${stamp(serp.retrievedAt)} from ${source}.`,
  ];
  if (serp.note) {
    lines.push('', `> ${serp.note}`);
  }

  lines.push('', '## The pages', '');
  lines.push('| # | Page | Words | H2s | Schema | FAQ | Images | Links in / out | Published | Updated |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const p of pages) {
    const f = p.facts;
    const page = `[${linkText(f?.title || p.serpTitle)}](${p.url}) · ${cell(p.domain)}`;
    if (!f) {
      lines.push(`| ${p.position} | ${page} | could not read: ${cell(p.error ?? 'no HTML')} | | | | | | ${cell(p.serpDate ?? '')} | |`);
      continue;
    }
    const h2s = f.outline.filter(h => h.level === 2).length;
    // A page whose text arrives by script reads as empty to a plain fetch; say
    // that rather than report a zero-word page.
    const words = f.wordCount === 0 ? 'no text without a browser (script-rendered)' : f.wordCount.toLocaleString('en-US');
    lines.push(`| ${p.position} | ${page} | ${words} | ${h2s} | ${cell(f.schemaTypes.join(', ') || 'none')} | ${f.faq.present ? `yes (${f.faq.via})` : 'no'} | ${f.imagesCount} | ${f.links.internal} / ${f.links.external} | ${cell(day(f.published) || p.serpDate || 'not stated')} | ${cell(day(f.updated) || 'not stated')} |`);
  }

  const read = pages.filter(p => p.facts && p.facts.wordCount > 0);
  if (read.length > 0) {
    const counts = read.map(p => p.facts!.wordCount).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)]!;
    lines.push('', `Median length ${median.toLocaleString('en-US')} words across the ${read.length} pages read; ${read.filter(p => p.facts!.faq.present).length} carry an FAQ.`);
  }

  if (serp.featuredSnippet) {
    const fs = serp.featuredSnippet;
    lines.push('', '## Featured snippet', '', `> ${cell(fs.snippet)}`, '', fs.url ? `From [${linkText(fs.title ?? fs.url)}](${fs.url}).` : 'Source not given.');
  }
  if (serp.peopleAlsoAsk.length > 0) {
    lines.push('', '## People also ask', '');
    for (const q of serp.peopleAlsoAsk) {
      lines.push(`- ${cell(q.question)}${q.url ? ` ([answer shown](${q.url}))` : ''}`);
    }
  }
  if (serp.relatedSearches.length > 0) {
    lines.push('', '## Related searches', '', serp.relatedSearches.map(cell).join(' · '));
  }

  const recurring = recurringHeadings(pages);
  lines.push('', '## Headings the top pages share', '');
  if (recurring.length === 0) {
    lines.push('No H2 or H3 recurs across two or more of the pages read.');
  } else {
    for (const r of recurring) {
      lines.push(`- ${cell(r.heading)} · ${r.positions.length} pages: ${cite(r.positions, pages)}`);
    }
  }

  lines.push('', '## Each page\'s outline');
  for (const p of pages.filter(x => x.facts)) {
    const f = p.facts!;
    lines.push('', `### ${p.position}. [${linkText(f.title || p.serpTitle)}](${p.url})`, '');
    if (f.metaDescription) {
      lines.push(`Meta description: ${cell(f.metaDescription)}`, '');
    }
    for (const h of f.outline) {
      lines.push(`${'  '.repeat(h.level - 1)}- H${h.level} ${cell(h.text)}`);
    }
    if (f.outline.length === 0) {
      lines.push('No H1 to H3 headings.');
    }
  }

  lines.push('', '## Synthesis', '', SYNTHESIS_START, '_Not written yet._', SYNTHESIS_END, '');
  return lines.join('\n');
}

/**
 * The synthesis block's markdown, every point cited to the pages behind it.
 * @param s - The agent's synthesis.
 * @param pages - The compared pages, for the citations.
 */
export function renderSynthesis(s: Synthesis, pages: ComparedPage[]): string {
  const point = (p: SynthesisPoint) => {
    const sources = cite(p.sources, pages);
    return `- ${p.point.trim()}${sources ? ` · ${sources}` : ' · (no page cited)'}`;
  };
  return [
    `**Search intent.** ${s.intent.trim()}`,
    '',
    '**What the top pages all cover**',
    '',
    ...(s.commonSubtopics.length ? s.commonSubtopics.map(point) : ['- None named.']),
    '',
    '**Gaps a new page could fill**',
    '',
    ...(s.gaps.length ? s.gaps.map(point) : ['- None named.']),
  ].join('\n');
}

/**
 * The brief with its synthesis written in, or null when the markers are gone
 * (a person edited them out) — the caller then says so rather than guessing
 * where it belongs.
 * @param md - The brief as stored.
 * @param synthesis - The synthesis markdown.
 */
export function withSynthesis(md: string, synthesis: string): string | null {
  const start = md.indexOf(SYNTHESIS_START);
  const end = md.indexOf(SYNTHESIS_END);
  if (start < 0 || end < start) {
    return null;
  }
  return `${md.slice(0, start + SYNTHESIS_START.length)}\n${synthesis}\n${md.slice(end)}`;
}
