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
import type { SharedTerm } from './textMatch';
import type { SerpResult } from './types';
import { clusterHeadings, sharedTerms } from './textMatch';

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
  /**
   * A directory, marketplace, social or reference site (`directories.ts`):
   * listed, but left out of the median, the shared headings and terms, and
   * what "the ranking pages cover".
   */
  directory?: boolean;
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
 * The pages a brief aggregates over: read, and not a directory.
 * @param pages - The compared pages.
 */
export function rankingPages(pages: ComparedPage[]): ComparedPage[] {
  return pages.filter(p => p.facts && !p.directory);
}

/**
 * H2/H3 headings that two or more of the ranking pages share, matched
 * loosely ("How We Tested!" and "Our testing process" are one), most-shared
 * first, with the positions of the pages that have them. Directories are
 * left out.
 * @param pages - The compared pages.
 * @param limit - How many to keep.
 */
export function recurringHeadings(pages: ComparedPage[], limit = 15): Array<{ heading: string; positions: number[]; variants: string[] }> {
  return clusterHeadings(rankingPages(pages).map(p => ({
    position: p.position,
    headings: p.facts!.outline.filter(h => h.level !== 1 && headingKey(h.text).length >= 3).map(h => h.text),
  })), limit);
}

/** How many ranking pages must use a term for it to count as shared. */
export const SHARED_TERM_MIN_PAGES = 3;

/**
 * Terms the ranking pages' body text shares (on at least three of them),
 * with which pages use each. Directories and the query's own words are left
 * out.
 * @param pages - The compared pages.
 * @param query - The query.
 * @param limit - How many to keep.
 */
export function termTable(pages: ComparedPage[], query: string, limit = 40): SharedTerm[] {
  return sharedTerms(rankingPages(pages).filter(p => p.facts!.text).map(p => ({ position: p.position, text: p.facts!.text })), { minPages: SHARED_TERM_MIN_PAGES, limit, exclude: query });
}

/** What `seo_save_research` reads back off a brief: the query and how it was read. */
export type SerpBriefMeta = { query: string; location?: string; google: boolean; provider: string };

const META_RE = /<!-- serp-brief (\{.*?\}) -->/;

/**
 * The brief's own record of what it was read for, or null on a brief filed
 * before it carried one.
 * @param md - The brief as stored.
 */
export function serpBriefMeta(md: string): SerpBriefMeta | null {
  const m = META_RE.exec(md);
  if (!m) {
    return null;
  }
  try {
    const v = JSON.parse(m[1]!) as Partial<SerpBriefMeta>;
    return typeof v.query === 'string' ? { query: v.query, google: v.google === true, provider: String(v.provider ?? ''), ...(typeof v.location === 'string' ? { location: v.location } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * A page's length, or why it has none: a page whose text arrives by script
 * reads as empty to a plain fetch, which is not a zero-word page.
 * @param f - What was read off the page.
 */
function wordsOf(f: PageFacts): string {
  return f.wordCount === 0 ? 'no text without a browser (script-rendered)' : f.wordCount.toLocaleString('en-US');
}

/**
 * The page's own latest date: updated, else published (said so), else the
 * date Google showed, else "not stated".
 * @param f - What was read off the page.
 * @param p - The compared page.
 */
function datedOf(f: PageFacts, p: ComparedPage): string {
  const updated = day(f.updated);
  if (updated) {
    return `${updated} (updated)`;
  }
  const published = day(f.published) || p.serpDate;
  return published ? `${published} (published)` : 'not stated';
}

/**
 * Everything else read off one page, as one line under its heading: what the
 * main table leaves out so it fits the pane.
 * @param f - What was read off the page.
 * @param p - The compared page.
 */
function pageDetails(f: PageFacts, p: ComparedPage): string {
  const h2s = f.outline.filter(h => h.level === 2).length;
  return [
    `**Words** ${wordsOf(f)}`,
    `**H2s** ${h2s}`,
    `**Schema** ${cell(f.schemaTypes.join(', ') || 'none')}`,
    `**FAQ** ${f.faq.present ? `yes (${f.faq.via})` : 'no'}`,
    `**Images** ${f.imagesCount}`,
    `**Links in / out** ${f.links.internal} / ${f.links.external}`,
    `**Published** ${cell(day(f.published) || p.serpDate || 'not stated')}`,
    `**Updated** ${cell(day(f.updated) || 'not stated')}`,
  ].join(' · ');
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
  const meta: SerpBriefMeta = { query: serp.query, ...(serp.location ? { location: serp.location } : {}), google: serp.isGoogleRanking, provider: serp.provider };
  const lines: string[] = [
    `# SERP brief: ${serp.query}`,
    `<!-- serp-brief ${JSON.stringify(meta).replace(/--/g, '\\u002d\\u002d')} -->`,
    '',
    `Top ${pages.length} for **${cell(serp.query)}**${where ? ` · ${where}` : ''} · read ${stamp(serp.retrievedAt)} from ${source}.`,
  ];
  if (serp.note) {
    lines.push('', `> ${serp.note}`);
  }

  // FOUR COLUMNS, SO THE TABLE FITS THE PANE (2026-10-29: ten columns ran
  // off the artifact pane). What else was read off each page is listed under
  // it in "Each page" below.
  lines.push('', '## The pages', '');
  lines.push('| # | Page | Words | Dated |');
  lines.push('|---|---|---|---|');
  for (const p of pages) {
    const f = p.facts;
    const page = `[${linkText(f?.title || p.serpTitle)}](${p.url}) · ${cell(p.domain)}${p.directory ? ' · directory' : ''}`;
    if (!f) {
      lines.push(`| ${p.position} | ${page} | could not read: ${cell(p.error ?? 'no HTML')} | ${cell(p.serpDate ?? '')} |`);
      continue;
    }
    lines.push(`| ${p.position} | ${page} | ${wordsOf(f)} | ${cell(datedOf(f, p))} |`);
  }

  const directories = pages.filter(p => p.directory);
  const read = rankingPages(pages).filter(p => p.facts!.wordCount > 0);
  if (read.length > 0) {
    const counts = read.map(p => p.facts!.wordCount).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)]!;
    lines.push('', `Median length ${median.toLocaleString('en-US')} words across the ${read.length} pages read; ${read.filter(p => p.facts!.faq.present).length} carry an FAQ.`);
  }
  if (directories.length > 0) {
    lines.push('', `${directories.length} of the top ${pages.length} are directories, marketplaces or social sites (${directories.map(p => `[#${p.position}](${p.url})`).join(' ')}): listed above, left out of the median, the shared headings and terms, and what the ranking pages cover.`);
  }

  const pack = serp.localPack ?? [];
  if (pack.length > 0) {
    lines.push('', '## Local pack', '', 'The businesses Google shows on the map for this search.', '');
    lines.push('| # | Business | Rating | Reviews | Category | Website | Address |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const b of pack) {
      const site = b.website ? `[${cell(b.domain || b.website)}](${b.website})` : 'none listed';
      lines.push(`| ${b.position} | ${cell(b.name)} | ${b.rating ?? ''} | ${b.reviews?.toLocaleString('en-US') ?? ''} | ${cell(b.category ?? '')} | ${site} | ${cell(b.address ?? '')} |`);
    }
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
      const also = r.variants.slice(1, 3).map(v => `“${cell(v)}”`).join(', ');
      lines.push(`- ${cell(r.heading)}${also ? ` (also ${also})` : ''} · ${r.positions.length} pages: ${cite(r.positions, pages)}`);
    }
  }

  const terms = termTable(pages, serp.query);
  lines.push('', '## Terms the top pages use', '');
  if (terms.length === 0) {
    lines.push(`No term recurs in the body text of ${SHARED_TERM_MIN_PAGES} or more of the pages read.`);
  } else {
    lines.push('| Term | Pages | Used on | Mentions |', '|---|---|---|---|');
    for (const t of terms) {
      lines.push(`| ${cell(t.term)} | ${t.positions.length} | ${cite(t.positions, pages)} | ${t.mentions} |`);
    }
  }

  lines.push('', '## Each page');
  for (const p of pages.filter(x => x.facts)) {
    const f = p.facts!;
    lines.push('', `### ${p.position}. [${linkText(f.title || p.serpTitle)}](${p.url})`, '');
    lines.push(pageDetails(f, p), '');
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
