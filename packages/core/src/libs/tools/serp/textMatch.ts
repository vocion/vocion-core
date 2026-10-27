/**
 * Plain, deterministic text comparison for SEO evidence: the same words
 * written two ways ("How We Tested!" / "Our testing process"), the terms the
 * top pages share in their body text, and how much of one page is another
 * page with the names swapped. Pure and dependency-free, so every rule is
 * tested on fixtures and every number it produces can be recomputed.
 *
 * This compares surface text the pages themselves wrote; it never reads
 * what a person meant (that is a model's job, `turnJudge.ts`).
 */

/** Function words and web chrome that say nothing about a page's subject. */
const STOPWORDS = new Set([
  'a',
  'about',
  'after',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'best',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'even',
  'every',
  'few',
  'for',
  'from',
  'get',
  'gets',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'like',
  'make',
  'many',
  'may',
  'me',
  'might',
  'more',
  'most',
  'much',
  'must',
  'my',
  'need',
  'new',
  'no',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'one',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'out',
  'over',
  'own',
  'per',
  're',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'us',
  'use',
  'used',
  'very',
  'want',
  'was',
  'way',
  'we',
  'well',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
  // Web chrome that survives the content extraction.
  'click',
  'cookie',
  'cookies',
  'copyright',
  'login',
  'menu',
  'newsletter',
  'privacy',
  'read',
  'reserved',
  'rights',
  'share',
  'sign',
  'skip',
  'subscribe',
]);

/**
 * Lower-case words, accents folded, punctuation gone; `'s` dropped so
 * "Fairview's" is "fairview".
 * @param text - Any text.
 */
export function words(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * A light English stemmer: enough that "tests", "tested" and "testing" are
 * one word, never so much that two different words collapse.
 * @param word - One lower-case word.
 */
export function stem(word: string): string {
  if (word.length <= 3 || /^\d+$/.test(word)) {
    return word;
  }
  let w = word;
  if (w.endsWith('ies') && w.length > 4) {
    w = `${w.slice(0, -3)}y`;
  } else if (/(?:ss|us|is)$/.test(w)) {
    // "glass", "status", "analysis": not plurals.
  } else if (/(?:ches|shes|xes|zes|sses)$/.test(w)) {
    w = w.slice(0, -2);
  } else if (w.endsWith('s')) {
    w = w.slice(0, -1);
  }
  if (w.endsWith('ing') && w.length > 5) {
    w = w.slice(0, -3);
  } else if (w.endsWith('ed') && w.length > 4) {
    w = w.slice(0, -2);
  } else if (w.endsWith('ly') && w.length > 4) {
    w = w.slice(0, -2);
  }
  // "install" + "ing" and "installation" both reach "install"; undo the
  // doubled consonant "testing" leaves as "test" but "planning" leaves as "plann".
  if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|zz)$/.test(w)) {
    w = w.slice(0, -1);
  }
  if (w.endsWith('ation') && w.length > 7) {
    w = w.slice(0, -5);
  }
  return w;
}

/**
 * Whether a word carries meaning on its own.
 * @param word - One lower-case word.
 */
export function isStopword(word: string): boolean {
  return STOPWORDS.has(word);
}

/**
 * What a heading says, as a set of stems: numbering, case, punctuation and
 * function words gone.
 * @param heading - The heading text.
 */
export function headingTokens(heading: string): Set<string> {
  return new Set(words(heading.replace(/^[\d.)\s-]+/, '')).filter(w => !isStopword(w)).map(stem));
}

/**
 * The share of two sets they have in common (Jaccard), 0 to 1.
 * @param a - One set.
 * @param b - The other.
 */
export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) {
    return 0;
  }
  let shared = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) {
    if (large.has(x)) {
      shared++;
    }
  }
  return shared / (a.size + b.size - shared);
}

/** Two headings say the same thing when at least half their stems are shared. */
export const HEADING_MATCH = 0.5;

/**
 * Whether two headings say the same thing: "How We Tested!" and "Our testing
 * process" do; "Cost" and "Water heater installation cost" do not.
 * @param a - One heading.
 * @param b - The other.
 */
export function headingsMatch(a: string, b: string): boolean {
  return jaccard(headingTokens(a), headingTokens(b)) >= HEADING_MATCH;
}

export type HeadingSource = { position: number; headings: string[] };

/**
 * Headings two or more pages share, matched loosely, most-shared first. Each
 * cluster is named by the wording most pages used.
 * @param pages - Each page's position and its H2/H3 headings.
 * @param limit - How many to keep.
 */
export function clusterHeadings(pages: HeadingSource[], limit = 15): Array<{ heading: string; positions: number[]; variants: string[] }> {
  type Cluster = { tokens: Set<string>; positions: Set<number>; wordings: Map<string, number> };
  const clusters: Cluster[] = [];
  for (const page of pages) {
    for (const raw of page.headings) {
      const text = raw.replace(/^[\d.)\s-]+/, '').trim();
      const tokens = headingTokens(text);
      if (tokens.size === 0) {
        continue;
      }
      let best: Cluster | null = null;
      let bestScore = 0;
      for (const c of clusters) {
        const score = jaccard(tokens, c.tokens);
        if (score >= HEADING_MATCH && score > bestScore) {
          best = c;
          bestScore = score;
        }
      }
      if (!best) {
        best = { tokens, positions: new Set(), wordings: new Map() };
        clusters.push(best);
      }
      best.positions.add(page.position);
      best.wordings.set(text, (best.wordings.get(text) ?? 0) + 1);
    }
  }
  return clusters
    .filter(c => c.positions.size >= 2)
    .map((c) => {
      const variants = [...c.wordings.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
      return { heading: variants[0]!, positions: [...c.positions].sort((a, b) => a - b), variants };
    })
    .sort((a, b) => b.positions.length - a.positions.length || a.heading.localeCompare(b.heading))
    .slice(0, limit);
}

export type TermSource = { position: number; text: string };

export type SharedTerm = {
  /** The wording most pages used. */
  term: string;
  /** Positions of the pages whose body uses it. */
  positions: number[];
  /** Times it appears across those pages. */
  mentions: number;
};

/**
 * Terms (one to three words, normalised and stemmed) that appear in the body
 * text of at least `minPages` pages, with which pages use them. The query's
 * own words are left out: every page uses them. A shorter term used by
 * exactly the pages a longer one is ("heater" inside "water heater") is
 * dropped for the longer one.
 * @param pages - Each page's position and main text.
 * @param opts - Options.
 * @param opts.minPages - How many pages must use a term (default 3).
 * @param opts.limit - How many to keep (default 40).
 * @param opts.exclude - Text whose words are left out (the query).
 */
export function sharedTerms(pages: TermSource[], opts: { minPages?: number; limit?: number; exclude?: string } = {}): SharedTerm[] {
  const minPages = opts.minPages ?? 3;
  const limit = opts.limit ?? 40;
  const excluded = new Set(words(opts.exclude ?? '').map(stem));
  const byKey = new Map<string, { n: number; positions: Set<number>; mentions: number; wordings: Map<string, number> }>();
  for (const page of pages) {
    const ws = words(page.text);
    const stems = ws.map(stem);
    for (let i = 0; i < ws.length; i++) {
      for (let n = 1; n <= 3 && i + n <= ws.length; n++) {
        const first = ws[i]!;
        const last = ws[i + n - 1]!;
        if (isStopword(first) || isStopword(last) || first.length < 2 || last.length < 2) {
          continue;
        }
        const keyParts = stems.slice(i, i + n);
        if (n === 1 && (first.length < 4 || /^\d+$/.test(first))) {
          continue;
        }
        if (keyParts.every(k => excluded.has(k) || /^\d+$/.test(k))) {
          continue;
        }
        const key = keyParts.join(' ');
        const entry = byKey.get(key) ?? { n, positions: new Set<number>(), mentions: 0, wordings: new Map<string, number>() };
        entry.positions.add(page.position);
        entry.mentions++;
        const wording = ws.slice(i, i + n).join(' ');
        entry.wordings.set(wording, (entry.wordings.get(wording) ?? 0) + 1);
        byKey.set(key, entry);
      }
    }
  }
  const common = [...byKey.entries()].filter(([, e]) => e.positions.size >= minPages);
  const samePages = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every(x => b.has(x));
  const kept = common.filter(([key, e]) => !common.some(([other, o]) => o.n > e.n && ` ${other} `.includes(` ${key} `) && samePages(o.positions, e.positions)));
  return kept
    .sort(([, a], [, b]) => b.positions.size - a.positions.size || b.n - a.n || b.mentions - a.mentions)
    .slice(0, limit)
    .map(([, e]) => ({
      term: [...e.wordings.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      positions: [...e.positions].sort((a, b) => a - b),
      mentions: e.mentions,
    }));
}

/**
 * Overlapping runs of `k` words (shingles) of a text, the unit near-duplicate
 * detection compares.
 * @param text - The text.
 * @param k - Words per shingle (default 5).
 */
export function shingles(text: string, k = 5): Set<string> {
  const ws = words(text);
  const out = new Set<string>();
  if (ws.length === 0) {
    return out;
  }
  if (ws.length < k) {
    out.add(ws.join(' '));
    return out;
  }
  for (let i = 0; i + k <= ws.length; i++) {
    out.add(ws.slice(i, i + k).join(' '));
  }
  return out;
}
