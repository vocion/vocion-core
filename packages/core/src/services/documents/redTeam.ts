/**
 * The red team — a sceptical buyer reading the document before the client does.
 *
 * The render-verify loop proves geometry (footers, overflow, page count) and
 * the look proves what a designer would notice. Neither reads the WORDS the way
 * the person on the other side will: the number nobody baselined, the outcome
 * quietly promised, the paragraph that invites a no, the scope line a buyer
 * could read two ways. Chris red-teamed the Armorock proposal by hand with a
 * second model and applied the findings (2026-09-18); this is that pass as a
 * tool, so every proposal gets it and the findings that recur become rules.
 *
 * Text, not pixels: each sheet's visible text goes to a model with a rubric —
 * core's generic one, plus whatever the calling skill adds (a plugin's house
 * rules, a workspace's voice bans) — and findings come back numbered, by
 * sheet, each with the rule it breaks and the fix. Same key discipline as the
 * look: the org's stored Anthropic key first, the server's otherwise, built
 * per call; no key means the pass is skipped and says so.
 */

import type { DocumentRedTeam } from '@/libs/cards/specs';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { DOCUMENT_FINDING_SEVERITIES, documentRedTeamFindingSchema } from '@/libs/cards/specs';
import { parseSheets, sheetLabel, textOf } from '@/libs/documents/sheets';
import { resolveOrgProviderKey } from '@/libs/llm/orgKey';

const REVIEW_MODEL = process.env.VOCION_REVIEW_MODEL ?? process.env.VOCION_VISION_MODEL ?? 'claude-sonnet-4-6';
/** Enough of a 12-sheet proposal to read every sheet; a sheet is ~2–4k characters of text. */
const MAX_CHARS_PER_SHEET = 6_000;
const MAX_SHEETS = 20;

/**
 * The finding shape is the STORED one (`libs/cards/specs.ts`), not a second
 * copy: what the reviewer returns is what lands on the document's spec and
 * what the export gate reads back, so there is one definition of a finding.
 */
export const SEVERITIES = DOCUMENT_FINDING_SEVERITIES;
export type Severity = typeof SEVERITIES[number];

const FindingsSchema = z.object({
  findings: z.array(documentRedTeamFindingSchema).max(40),
  /** One or two sentences: what the document does well, so the fixes do not erase it. */
  keeps: z.string().max(400).optional(),
});
export type RedTeamFinding = z.infer<typeof FindingsSchema>['findings'][number];

export type RedTeamOutcome
  = | { status: 'reviewed'; findings: RedTeamFinding[]; keeps: string | null; model: string; sheets: number }
    | { status: 'skipped'; reason: string };

/**
 * The review runs as a TOOL CALL, not as "return JSON and nothing else".
 *
 * The first live run (2026-09-19, the Armorock proposal) came back unparseable
 * twice and the agent read the document by hand instead — a sceptical reviewer
 * writes long, and a dozen findings do not fit the budget the prose form was
 * given, so the JSON was cut mid-object. A declared tool the model must call
 * removes both failure modes at once: the shape is the schema's, and what is
 * left is only ever a length problem, which the receipt now names.
 */
const FINDINGS_TOOL = {
  name: 'report_findings',
  description: 'Report the red-team findings on this document. Call this exactly once.',
  input_schema: {
    type: 'object' as const,
    properties: {
      findings: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            sheet: { type: 'integer', description: 'The sheet number the finding is on.' },
            severity: { type: 'string', enum: [...SEVERITIES] },
            rule: { type: 'string', description: 'The rubric rule it breaks, in a few words.' },
            finding: { type: 'string', description: 'What a buyer reads, in one or two sentences. Quote briefly where it helps.' },
            fix: { type: 'string', description: 'The edit that answers it.' },
          },
          required: ['sheet', 'severity', 'rule', 'finding', 'fix'],
        },
      },
      keeps: { type: 'string', description: 'One or two sentences on what to keep, so the fixes do not erase it.' },
    },
    required: ['findings'],
  },
};

/**
 * The generic rubric every client document is read against. A calling skill
 * appends its own (house structure, pricing shape); the workspace's voice bans
 * arrive as `bannedPhrases`. Written as what a sceptical buyer checks.
 */
export const DEFAULT_RUBRIC = [
  'GROUNDING — every number, date, name and quote must trace to something the seller was told or can cite; an unsourced figure is a `block` unless it is visibly marked as a placeholder to be baselined.',
  'NO OUTCOME PROMISES — the seller commits to capabilities and to measuring together, never to a business result (revenue, savings, a percentage improvement, a date something will be true). A projected performance figure is a `block`.',
  'PLACEHOLDERS ARE HONEST — anything unbaselined is shown as a placeholder in the open, never as a confident number, and never silently dropped.',
  'THE CLIENT\'S WORDS ARE THE SPINE — their product names, stage names and vocabulary, their actual questions answered in their terms; a pull-quote should be something they said, attributed and dated.',
  'SCOPE IS UNAMBIGUOUS — what is in, what is out, what comes later are visually and verbally unmistakable; anything a buyer could read as included that is not is a `fix`.',
  'ASSUME THE YES — no line invites a no, hedges the offer, or pre-emptively argues against itself; cut it.',
  'ONE DECISION, WELL FRAMED — next steps are concrete (confirm, send the inputs, kickoff) with a real date or the reason there is none; the buyer knows what happens when they say yes and what they get if they stop.',
  'COMMERCIAL CLARITY — price, term, what is invoiced when, what is included, what runs at cost after, ownership of data and deliverables; any of these missing or contradictory is a `fix`.',
  'NO CHATBOT REGISTER — no antithesis ("not X, but Y"), no consultant jargon for the client\'s world, no prose em-dashes, no aphorisms, no "say so plainly"; numerals not words for numbers.',
  'STRUCTURE — one idea per sheet, each sheet earns its place, illustrations are labelled illustrative and show categories rather than invented results, the last sheets are the ask and the roadmap marked out of scope.',
].join('\n');

/**
 * The document as the reviewer reads it: one text block per sheet, labelled,
 * capped. Pure; exported for tests.
 * @param html - The whole document.
 */
export function prepareSheetsText(html: string): Array<{ n: number; label: string; text: string }> {
  const parsed = parseSheets(html);
  return parsed.sheets.slice(0, MAX_SHEETS).map((s, i) => ({
    n: i + 1,
    label: sheetLabel(s.html),
    text: textOf(s.html).slice(0, MAX_CHARS_PER_SHEET),
  }));
}

/**
 * Parse the model's answer into findings, or null when it is not the shape
 * asked for. Takes the tool-call input when there was one and falls back to
 * JSON in the text, because a model that answers in prose anyway should still
 * be read rather than thrown away. Pure; exported for tests.
 * @param text - The model's reply, or the JSON of its tool call.
 */
export function parseFindings(text: string): z.infer<typeof FindingsSchema> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = FindingsSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  // One long finding must not lose the other eleven: keep the entries that
  // validate, drop the ones that do not, and only give up when none survive.
  const loose = z.object({ findings: z.array(z.unknown()).optional(), keeps: z.unknown().optional() }).safeParse(value);
  if (!loose.success || !loose.data.findings) {
    return null;
  }
  const FindingSchema = FindingsSchema.shape.findings.element;
  const kept = loose.data.findings.map(f => FindingSchema.safeParse(f)).filter(r => r.success).map(r => r.data);
  if (kept.length === 0) {
    return null;
  }
  return { findings: kept, keeps: typeof loose.data.keeps === 'string' ? loose.data.keeps.slice(0, 400) : undefined };
}

const SEVERITY_ORDER: Record<Severity, number> = { block: 0, fix: 1, consider: 2 };

/**
 * Findings in the order they must be answered: blocks first, then by sheet.
 * Pure; exported for tests.
 * @param findings - Findings in whatever order the reviewer returned them.
 */
export function bySeverity(findings: readonly RedTeamFinding[]): RedTeamFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.sheet - b.sheet);
}

/** Findings stored on a document, capped: a spec is a row, not a transcript. */
const MAX_STORED_FINDINGS = 20;

/**
 * The review as the document carries it — counts by severity and the findings
 * themselves, blocks first so the cap never drops a blocker in favour of a
 * `consider`. Pure; exported for tests.
 * @param outcome - A review that ran.
 * @param version - The artifact version whose HTML was read.
 */
export function redTeamRecord(outcome: Extract<RedTeamOutcome, { status: 'reviewed' }>, version: number): DocumentRedTeam {
  const sorted = bySeverity(outcome.findings);
  return {
    at: new Date().toISOString(),
    version,
    model: outcome.model,
    sheets: outcome.sheets,
    blocks: sorted.filter(f => f.severity === 'block').length,
    fixes: sorted.filter(f => f.severity === 'fix').length,
    considers: sorted.filter(f => f.severity === 'consider').length,
    findings: sorted.slice(0, MAX_STORED_FINDINGS),
    ...(outcome.keeps ? { keeps: outcome.keeps } : {}),
  };
}

/**
 * The receipt the agent reads: findings by severity, each with sheet, rule
 * and fix, then what to do with them. Pure; exported for tests.
 * @param outcome - The review.
 */
export function redTeamReceipt(outcome: RedTeamOutcome): string {
  if (outcome.status === 'skipped') {
    return `Red team skipped: ${outcome.reason}.`;
  }
  const sorted = bySeverity(outcome.findings);
  const blocks = sorted.filter(f => f.severity === 'block').length;
  const fixes = sorted.filter(f => f.severity === 'fix').length;
  const lines = [
    `Red team (${outcome.model}, ${outcome.sheets} sheets): ${sorted.length === 0 ? 'no findings — a sceptical buyer would sign this as written.' : `${blocks} blocking · ${fixes} to fix · ${sorted.length - blocks - fixes} to consider.`}`,
  ];
  sorted.forEach((f, i) => {
    lines.push(`${i + 1}. [${f.severity.toUpperCase()}] sheet ${f.sheet} · ${f.rule}: ${f.finding} → ${f.fix}`);
  });
  if (outcome.keeps) {
    lines.push('', `Keep: ${outcome.keeps}`);
  }
  if (blocks > 0) {
    lines.push('', 'A BLOCK is not sent. Fix each with edit_document by sheet, then run red_team_document again; a finding that appears on a second document is a rule — add it as a learning so the next proposal starts without it.');
  } else if (fixes > 0) {
    lines.push('', 'Fix these with edit_document by sheet, then verify. Anything you decide to leave, say why in one line.');
  }
  return lines.join('\n');
}

/**
 * Read a document as a sceptical buyer and return numbered findings.
 * @param orgId - The workspace, for the key.
 * @param input
 * @param input.html - The whole document.
 * @param input.rubric - Rules to read against, appended to the generic rubric.
 * @param input.context - What the seller actually knows (the room's starred sources, in brief), so "unsourced" is judged against it.
 * @param input.bannedPhrases - The workspace's voice bans; any occurrence is a finding.
 * @param input.onProgress - Where the pass has got to, as a phrase for the running step line. The review is ONE model call over the whole document, so the only honest note is that it has started and on how many sheets — there is no sheet-by-sheet progress to report and none is invented.
 */
export async function redTeamDocument(orgId: string, input: { html: string; rubric?: string | null; context?: string | null; bannedPhrases?: string[]; onProgress?: (note: string) => void }): Promise<RedTeamOutcome> {
  const apiKey = (await resolveOrgProviderKey('anthropic', orgId)) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no Anthropic key is configured for this workspace or the server' };
  }
  const sheets = prepareSheetsText(input.html);
  if (sheets.length === 0) {
    return { status: 'skipped', reason: 'no sheets to read' };
  }
  try {
    input.onProgress?.(`reading ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}`);
  } catch {
    // Telling someone what is happening may never break the thing happening.
  }
  const system = [
    'You are the sceptical buyer on the other side of a B2B proposal: an operations lead who has to carry this into an internal business case and be right. You read for what would make you hesitate, push back, or quietly lose confidence.',
    'Report findings ONLY — never praise per sheet, never restate the document. Each finding names the sheet number, the rule it breaks, what you read (quote briefly when it helps), and the edit that would answer it.',
    'Severity: `block` = must change before this is sent (an unsourced number, a promised outcome, a contradiction in price or scope); `fix` = a buyer would notice and it costs trust; `consider` = a judgement call worth a look.',
    'Answer by calling report_findings exactly once, with nothing before it. Fewer, sharper findings beat many small ones: at most fifteen, and keep each finding under sixty words so they all fit.',
  ].join(' ');
  const rubric = [DEFAULT_RUBRIC, input.rubric?.trim() ? `HOUSE RULES (from the seller's own skill):\n${input.rubric.trim()}` : '', input.bannedPhrases?.length ? `BANNED PHRASES (any occurrence is a fix): ${input.bannedPhrases.join(' · ')}` : ''].filter(Boolean).join('\n\n');
  const body = sheets.map(s => `--- Sheet ${s.n}${s.label ? ` · ${s.label}` : ''} ---\n${s.text}`).join('\n\n');
  const user = [
    `RUBRIC\n${rubric}`,
    input.context?.trim() ? `WHAT THE SELLER ACTUALLY KNOWS (judge "unsourced" against this)\n${input.context.trim().slice(0, 8_000)}` : 'WHAT THE SELLER ACTUALLY KNOWS: not supplied — treat any specific figure as unsourced unless the sheet itself marks its source.',
    `THE DOCUMENT (${sheets.length} sheets)\n${body}`,
    'Return the JSON now.',
  ].join('\n\n');
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: REVIEW_MODEL,
    // A dozen findings on a twelve-sheet document is several thousand tokens
    // of output; the first live run was cut off at 3000 and returned nothing
    // usable. Budget for the whole answer rather than for the average one.
    max_tokens: 8_000,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: user }],
    tools: [FINDINGS_TOOL],
    tool_choice: { type: 'tool', name: FINDINGS_TOOL.name },
  });
  const call = res.content.find(b => b.type === 'tool_use' && b.name === FINDINGS_TOOL.name);
  const text = call
    ? JSON.stringify((call as { input: unknown }).input)
    : res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
  const parsed = parseFindings(text);
  if (!parsed) {
    // Say which failure it was, so the next one is diagnosable from the
    // receipt instead of from a log nobody is reading (principle 10).
    const why = res.stop_reason === 'max_tokens'
      ? 'the review ran past its length budget before it finished — ask for fewer findings, or split the document'
      : `the review model answered in an unusable shape (stop_reason ${res.stop_reason ?? 'unknown'}${call ? ', tool call did not validate' : ', no tool call'})`;
    return { status: 'skipped', reason: why };
  }
  return { status: 'reviewed', findings: parsed.findings, keeps: parsed.keeps?.trim() || null, model: REVIEW_MODEL, sheets: sheets.length };
}
