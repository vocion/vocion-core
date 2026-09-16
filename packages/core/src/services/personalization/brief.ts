/**
 * The reduction pass, applied to a research brief.
 *
 * > **Less evidence should produce a smaller brief, not a longer explanation
 * > of why evidence is missing.**
 * > — `docs/design/reduction.md`, and the rule the CEO's review of this exact
 * > page is the worked example of.
 *
 * The old brief rendered, for a lead where the system knew four facts:
 * Prospect · Research That Matters · Recommended Angle · Opening Question ·
 * Case Study · Missing · Claims · Confidence · Timeline · CRM Context · a
 * second Missing · Reference Articles. The same absence was restated six or
 * seven times in slightly different words.
 *
 * This module reduces that to five sections and enforces the reduction
 * STRUCTURALLY, which is the part that matters:
 *
 * - **A section with nothing to say is omitted**, not rendered with an empty
 *   state. The renderer has no empty-state branch to reach, because the
 *   section is not in the array (reduction.md, failure 2).
 * - **A repeated absence is de-duplicated here, in code** — not asked of the
 *   model. `absenceKey()` normalises "No company website found for X", "We
 *   could not establish what the company does" and "Company size not
 *   published" into comparable keys, and a section whose body says nothing but
 *   an absence already recorded is dropped rather than reprinted.
 * - **Everything that is not one of the five moves to Evidence**, which is a
 *   drawer, not a column.
 *
 * What comes out is typed, not markdown: the page renders the structure, and
 * `briefMarkdown()` serialises the same structure for the brief ARTIFACT, so
 * the two can never drift.
 */

import type { ConfidenceDimensions } from './confidence';
import { CONFIDENCE_DIMENSIONS, DIMENSION_LABEL, headlineConfidence } from './confidence';

/** A brief section as the lead row stores it. */
export type BriefSection = { heading: string; body: string };

export type BriefClaim = { text: string; kind: string; source: string; date?: string };

/** The five headings a reduced brief may contain, in order. */
export const BRIEF_SECTIONS = [
  'What we know',
  'What we couldn\'t verify',
  'Recommended angle',
  'Sources',
  'Research confidence',
] as const;

export type BriefSectionName = (typeof BRIEF_SECTIONS)[number];

/**
 * Where each heading the skill has ever written ends up. Anything not named
 * here goes to Evidence, which is the safe default: a new section the skill
 * invents appears in the drawer rather than silently disappearing.
 */
const HEADING_MAP: Record<string, BriefSectionName | 'evidence'> = {
  'prospect': 'What we know',
  'about the prospect': 'What we know',
  'research that matters': 'What we know',
  'company': 'What we know',
  'recommended angle': 'Recommended angle',
  'angle': 'Recommended angle',
  'missing': 'What we couldn\'t verify',
  'research gaps': 'What we couldn\'t verify',
  'gaps': 'What we couldn\'t verify',
  'brief confidence': 'Research confidence',
  'confidence': 'Research confidence',
  // Deliberately Evidence: real content, but not what a reviewer needs in the
  // first thirty seconds. They are one click away, not deleted.
  'opening question': 'evidence',
  'case study': 'evidence',
  'crm context': 'evidence',
  'acquisition context': 'evidence',
  'reference articles': 'evidence',
  'claims': 'evidence',
  'timeline': 'evidence',
};

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Does this sentence say only that something is missing?
 *
 * Used twice: to mine absences out of prose so they can be said once, and to
 * decide that a whole section is nothing but absence narration.
 * @param text - One sentence or one short body.
 */
export function isAbsenceStatement(text: string): boolean {
  const t = norm(text);
  if (!t) {
    return false;
  }
  return /\b(?:could ?n[o']?t|cannot|can't|unable to|was not able to|no |none |not published|not available|unavailable|unknown|nothing (?:is )?known|we don'?t know|failed to (?:retrieve|fetch|load|reach))\b/.test(t);
}

/**
 * A comparison key for one statement of absence.
 *
 * "No company website found for Northgate Facilities", "We could not retrieve
 * the company website" and "The website could not be retrieved" are the same
 * absence written three ways; all three reduce to the same key, so the brief
 * says it once. Strips the hedging verbs, the articles, and the plural, and
 * keeps the nouns.
 * @param text - A statement of absence.
 */
export function absenceKey(text: string): string {
  return norm(text)
    .replace(/[^a-z0-9\s]+/g, ' ')
    // The ways of saying "we did not get it" carry no distinguishing content.
    .replace(/\b(?:we|[ia]|it|the|an|this|that|there|its|their|his|her|for|of|to|in|on|at|is|was|were|are|be|been|has|have|had|no|not|none|any|could|couldn|cannot|can|t|unable|failed|nothing|known|know|dont|don|found|find|retrieve|retrieved|fetch|fetched|reach|reached|establish|established|confirm|confirmed|verify|verified|publish|published|available|unavailable|unknown|outside|record|records)\b/g, ' ')
    .replace(/\b(\w+?)s\b/g, '$1')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Is this absence already recorded, allowing for one being a shorter way of
 * saying the other?
 *
 * Exact key equality is not enough, and the CEO's example is why: "No company
 * website found for Kestrel Capital", "We could not retrieve the company
 * website" and "The website could not be retrieved" reduce to `capital company
 * kestrel website`, `company website` and `website`. They are one absence
 * written at three levels of specificity, so the test is SUBSET, not equality:
 * if everything the new statement says is already said, it adds nothing.
 * @param key - The candidate absence's key.
 * @param seen - Keys already recorded.
 */
export function absenceCovered(key: string, seen: readonly string[]): boolean {
  const tokens = key.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    // Content-free absence narration — "None retrieved.", "Nothing found."
    // It distinguishes nothing, so it is never worth a line of its own.
    return true;
  }
  return seen.some((s) => {
    const other = new Set(s.split(' ').filter(Boolean));
    if (other.size === 0) {
      return false;
    }
    const subset = tokens.every(t => other.has(t));
    const superset = [...other].every(t => tokens.includes(t));
    return subset || superset;
  });
}

/**
 * Split a body into sentences, cheaply. Deliberately not a parser: it only has
 * to be good enough to notice that a paragraph is three restatements of the
 * same gap.
 * @param body - A section body.
 */
function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.replace(/^[-*>\s]+/, '').trim())
    .filter(s => s.length > 0);
}

export type ReducedBrief = {
  /** The five, in order, with empties omitted. */
  brief: BriefSection[];
  /** Everything else, in the order it arrived. */
  evidence: BriefSection[];
  /** The de-duplicated absences, as the one place they are stated. */
  gaps: string[];
  /** What the reduction dropped, and why — the audit for the pass itself. */
  dropped: Array<{ heading: string; reason: 'empty' | 'duplicate-absence' }>;
};

export type ReduceBriefInput = {
  sections: readonly BriefSection[];
  missing: readonly string[];
  claims: readonly BriefClaim[];
  dimensions?: ConfidenceDimensions | null;
  /** Falls back to the row's stored self-assessment when no dimensions exist. */
  confidence?: number | null;
};

/**
 * The unique source hosts behind the claims — the Sources chips.
 * @param claims
 */
export function briefSources(claims: readonly BriefClaim[]): Array<{ source: string; kind: string }> {
  const seen = new Map<string, string>();
  for (const c of claims) {
    if (!seen.has(c.source)) {
      seen.set(c.source, c.kind);
    }
  }
  return [...seen].map(([source, kind]) => ({ source, kind }));
}

/**
 * Reduce a generated brief to the five sections, once each.
 * @param input - The stored sections, gaps, claims and computed dimensions.
 */
export function reduceBrief(input: ReduceBriefInput): ReducedBrief {
  const dropped: ReducedBrief['dropped'] = [];

  // 1. The gaps, said ONCE. `missing` is authoritative; prose that restates a
  //    gap already there adds nothing, and prose that names a NEW gap is
  //    promoted here rather than left buried in a paragraph.
  const gaps: string[] = [];
  const gapKeys = new Set<string>();
  const addGap = (text: string): boolean => {
    const t = text.trim();
    if (!t) {
      return false;
    }
    const key = absenceKey(t);
    if (absenceCovered(key, [...gapKeys])) {
      return false;
    }
    gapKeys.add(key);
    gaps.push(t);
    return true;
  };
  for (const m of input.missing) {
    addGap(m);
  }

  // 2. Fold the prose sections onto the five, dropping anything that is only a
  //    restatement of a gap now recorded above.
  const buckets = new Map<BriefSectionName, string[]>();
  const evidence: BriefSection[] = [];

  for (const section of input.sections) {
    const body = section.body.trim();
    if (!body) {
      dropped.push({ heading: section.heading, reason: 'empty' });
      continue;
    }
    const target = HEADING_MAP[norm(section.heading)] ?? 'evidence';

    if (target === 'What we couldn\'t verify') {
      // A Missing-shaped section contributes its lines to the one gap list.
      let added = false;
      for (const line of sentences(body)) {
        added = addGap(line) || added;
      }
      if (!added) {
        dropped.push({ heading: section.heading, reason: 'duplicate-absence' });
      }
      continue;
    }

    const lines = sentences(body);
    const kept = lines.filter((line) => {
      if (!isAbsenceStatement(line)) {
        return true;
      }
      // Already said, in the section that owns it — or content-free.
      if (absenceCovered(absenceKey(line), [...gapKeys])) {
        return false;
      }
      gapKeys.add(absenceKey(line));
      gaps.push(line);
      return false;
    });

    if (kept.length === 0) {
      dropped.push({ heading: section.heading, reason: 'duplicate-absence' });
      continue;
    }

    const rebuilt = kept.join(' ');
    if (target === 'evidence') {
      evidence.push({ heading: section.heading, body: rebuilt });
    } else {
      buckets.set(target, [...(buckets.get(target) ?? []), rebuilt]);
    }
  }

  // 3. Assemble, in the settled order, omitting anything with nothing to say.
  const brief: BriefSection[] = [];
  const push = (heading: BriefSectionName, body: string): void => {
    const b = body.trim();
    if (b) {
      brief.push({ heading, body: b });
    }
  };

  push('What we know', (buckets.get('What we know') ?? []).join('\n\n'));
  push('What we couldn\'t verify', gaps.map(g => `- ${g}`).join('\n'));
  push('Recommended angle', (buckets.get('Recommended angle') ?? []).join('\n\n'));

  const sources = briefSources(input.claims);
  push('Sources', sources.map(s => `- ${s.source}`).join('\n'));

  // Research confidence is COMPUTED, never narrated: a section that would say
  // "confidence is low because we could not establish much" is the absence,
  // restated a seventh time. The dimensions carry the detail.
  const headline = input.dimensions ? headlineConfidence(input.dimensions) : input.confidence;
  if (headline != null) {
    const detail = input.dimensions
      ? CONFIDENCE_DIMENSIONS
          .map(k => `- ${DIMENSION_LABEL[k]}: ${input.dimensions![k].value === null ? 'unavailable' : `${Math.round(input.dimensions![k].value! * 100)}%`}`)
          .join('\n')
      : '';
    push('Research confidence', detail);
  }
  // The model's own Brief Confidence prose, if it wrote any, is not kept: the
  // number and its dimensions say it, and shorter.
  for (const s of buckets.get('Research confidence') ?? []) {
    if (s.trim()) {
      dropped.push({ heading: 'Research confidence', reason: 'duplicate-absence' });
    }
  }

  return { brief, evidence, gaps, dropped };
}

/**
 * The brief artifact's markdown — the same structure, serialised once.
 * @param reduced - The reduction's output.
 * @param title - The artifact's title, used as the H1.
 */
export function briefMarkdown(reduced: ReducedBrief, title: string): string {
  const parts = [`# ${title}`];
  for (const section of reduced.brief) {
    parts.push(`## ${section.heading}\n\n${section.body}`);
  }
  return parts.join('\n\n');
}
