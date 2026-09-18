/**
 * Progressive disclosure, in code (`docs/specs/briefing-v2.md` §7–§9).
 *
 * > "`hs_deal_stage_probability` exists in HubSpot's schema but is not
 * > returned by the counting tools available" is good transparency for
 * > debugging, but it does not belong in the primary briefing.
 *
 * > The briefing should not make me inspect whether `proposal-writer` ran 0/0
 * > times.
 *
 * System vocabulary — agent slugs, job names, tool names, token counts, run
 * ids, connector field names, schema identifiers — is admissible in exactly
 * two sections: `agentActivity` and `provenance`. Everywhere else this pass
 * pulls it out of the prose and parks it in a footnote under *Sources & run
 * details*, so the truth is moved, never deleted (manifesto §12: hide
 * complexity, never hide truth).
 *
 * Pure and vocabulary-driven: the caller supplies the workspace's own agent
 * slugs, job names and tool names, and the generic patterns below catch the
 * shapes that are system vocabulary whatever they are called.
 */

/** What kind of system token was found — the footnote says this out loud. */
export type RedactedKind = 'agent' | 'job' | 'tool' | 'tokens' | 'run-id' | 'connector-field' | 'schema-identifier';

export type RedactionFootnote = {
  marker: number;
  token: string;
  kind: RedactedKind;
  note?: string;
};

export type RedactionVocabulary = {
  /** The workspace's agent slugs (`agent.slug`). */
  agents?: readonly string[];
  /** Registered job names (`services/jobs/registry.ts`). */
  jobs?: readonly string[];
  /** Registered agent tool names (`services/agents/tools/registry.ts`). */
  tools?: readonly string[];
};

/** The neutral phrase each kind is replaced by, so the sentence still reads. */
const REPLACEMENT: Record<RedactedKind, string> = {
  'agent': 'a teammate',
  'job': 'a scheduled job',
  'tool': 'a tool',
  'tokens': 'model usage',
  'run-id': 'a run',
  'connector-field': 'a connector field',
  'schema-identifier': 'an internal record',
};

/**
 * Shapes that are system vocabulary no matter what the workspace calls them.
 * Order matters: the most specific pattern wins the text it matches.
 */
const GENERIC_PATTERNS: { kind: RedactedKind; re: RegExp }[] = [
  // "12,345 tokens", "Tokens 0", "0 tokens"
  { kind: 'tokens', re: /\b(?:tokens?\s+[\d,]+|[\d,]+\s+tokens?)\b/gi },
  // A uuid, or "run 4f2a9c", or "run_id=…", or "#run-123"
  { kind: 'run-id', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: 'run-id', re: /\brun[\s_-]?(?:id[\s:=]+)?#?[0-9a-f]{6,}\b/gi },
  // Known CRM / connector field prefixes — `hs_deal_stage_probability`.
  { kind: 'connector-field', re: /\b(?:hs|hubspot|gcal|ga4|sf|sfdc|gmail|slack)_[a-z0-9]+(?:_[a-z0-9]+)*\b/gi },
  // Anything else spelled snake_case is one of ours: a table, a column, a tool.
  { kind: 'schema-identifier', re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pull system vocabulary out of one narrative string.
 *
 * Matches are replaced with a plain-English stand-in plus a footnote marker
 * (`a connector field [1]`), and the footnote itself carries the exact token
 * so `provenance` can show it. Markers continue from `startMarker`, so a
 * whole document numbers its footnotes once.
 * @param text - The prose to clean.
 * @param vocab - The workspace's own slugs, jobs and tool names.
 * @param startMarker - Next footnote number to use.
 */
export function redactSystemVocabulary(
  text: string,
  vocab: RedactionVocabulary = {},
  startMarker = 1,
): { text: string; footnotes: RedactionFootnote[] } {
  const footnotes: RedactionFootnote[] = [];
  const seen = new Map<string, number>();
  let marker = startMarker;

  const take = (token: string, kind: RedactedKind): string => {
    const existing = seen.get(token.toLowerCase());
    if (existing !== undefined) {
      return `${REPLACEMENT[kind]} [${existing}]`;
    }
    const n = marker++;
    seen.set(token.toLowerCase(), n);
    footnotes.push({ marker: n, token, kind });
    return `${REPLACEMENT[kind]} [${n}]`;
  };

  let out = text;

  // Workspace vocabulary first — a named agent slug is an agent, not a
  // generic hyphenated word, and `daily-team-report` is a job, not prose.
  const named: { kind: RedactedKind; values: readonly string[] }[] = [
    { kind: 'agent', values: vocab.agents ?? [] },
    { kind: 'job', values: vocab.jobs ?? [] },
    { kind: 'tool', values: vocab.tools ?? [] },
  ];
  for (const { kind, values } of named) {
    for (const value of [...values].sort((a, b) => b.length - a.length)) {
      if (!value.trim()) {
        continue;
      }
      // Backticked or bare, but only as a whole word.
      const re = new RegExp(`\`?\\b${escapeRe(value)}\\b\`?`, 'gi');
      out = out.replace(re, m => take(m.replace(/`/g, ''), kind));
    }
  }

  for (const { kind, re } of GENERIC_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), (m) => {
      // Never re-redact a stand-in we just wrote.
      if (/^\s*\[\d+\]\s*$/.test(m)) {
        return m;
      }
      return take(m, kind);
    });
  }

  // Backticks around a replaced token leave stray marks behind.
  out = out.replace(/`+(\s*\[\d+\])/g, '$1').replace(/\s{2,}/g, ' ');

  return { text: out, footnotes };
}

/**
 * Does this string still carry system vocabulary? The validator's assertion
 * for the narrative sections — cheaper than redacting and comparing, and it
 * is what the test asserts about a rendered brief.
 * @param text - The prose to check.
 * @param vocab - The workspace's own slugs, jobs and tool names.
 */
export function containsSystemVocabulary(text: string, vocab: RedactionVocabulary = {}): boolean {
  return redactSystemVocabulary(text, vocab).footnotes.length > 0;
}
