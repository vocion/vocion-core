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

import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { parseSheets, sheetLabel, textOf } from '@/libs/documents/sheets';
import { resolveOrgProviderKey } from '@/libs/llm/orgKey';

const REVIEW_MODEL = process.env.VOCION_REVIEW_MODEL ?? process.env.VOCION_VISION_MODEL ?? 'claude-sonnet-4-6';
/** Enough of a 12-sheet proposal to read every sheet; a sheet is ~2–4k characters of text. */
const MAX_CHARS_PER_SHEET = 6_000;
const MAX_SHEETS = 20;

export const SEVERITIES = ['block', 'fix', 'consider'] as const;
export type Severity = typeof SEVERITIES[number];

const FindingsSchema = z.object({
  findings: z.array(z.object({
    sheet: z.number().int().min(0),
    severity: z.enum(SEVERITIES),
    /** The rubric rule it breaks, in a few words: "outcome promised". */
    rule: z.string().min(1).max(80),
    /** What a buyer would read, quoting the sheet where it helps. */
    finding: z.string().min(1).max(400),
    /** The edit that answers it. */
    fix: z.string().min(1).max(300),
  })).max(40),
  /** One or two sentences: what the document does well, so the fixes do not erase it. */
  keeps: z.string().max(400).optional(),
});
export type RedTeamFinding = z.infer<typeof FindingsSchema>['findings'][number];

export type RedTeamOutcome
  = | { status: 'reviewed'; findings: RedTeamFinding[]; keeps: string | null; model: string; sheets: number }
    | { status: 'skipped'; reason: string };

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
 * Parse the model's answer into findings, or null when it is not the JSON asked for. Pure; exported for tests.
 * @param text - The model's reply.
 */
export function parseFindings(text: string): z.infer<typeof FindingsSchema> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return FindingsSchema.parse(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
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
  const order: Record<Severity, number> = { block: 0, fix: 1, consider: 2 };
  const sorted = [...outcome.findings].sort((a, b) => order[a.severity] - order[b.severity] || a.sheet - b.sheet);
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
 */
export async function redTeamDocument(orgId: string, input: { html: string; rubric?: string | null; context?: string | null; bannedPhrases?: string[] }): Promise<RedTeamOutcome> {
  const apiKey = (await resolveOrgProviderKey('anthropic', orgId)) ?? process.env.ANTHROPIC_API_KEY ?? null;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no Anthropic key is configured for this workspace or the server' };
  }
  const sheets = prepareSheetsText(input.html);
  if (sheets.length === 0) {
    return { status: 'skipped', reason: 'no sheets to read' };
  }
  const system = [
    'You are the sceptical buyer on the other side of a B2B proposal: an operations lead who has to carry this into an internal business case and be right. You read for what would make you hesitate, push back, or quietly lose confidence.',
    'Report findings ONLY — never praise per sheet, never restate the document. Each finding names the sheet number, the rule it breaks, what you read (quote briefly when it helps), and the edit that would answer it.',
    'Severity: `block` = must change before this is sent (an unsourced number, a promised outcome, a contradiction in price or scope); `fix` = a buyer would notice and it costs trust; `consider` = a judgement call worth a look.',
    'Return STRICT JSON and nothing else: {"findings":[{"sheet":<n>,"severity":"block|fix|consider","rule":"<few words>","finding":"<one or two sentences>","fix":"<the edit>"}],"keeps":"<one or two sentences on what to keep>"}. Fewer, sharper findings beat many small ones; cap at the ones that matter.',
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
  const res = await client.messages.create({ model: REVIEW_MODEL, max_tokens: 3000, temperature: 0, system, messages: [{ role: 'user', content: user }] });
  const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
  const parsed = parseFindings(text);
  if (!parsed) {
    return { status: 'skipped', reason: 'the review model returned something other than the findings JSON' };
  }
  return { status: 'reviewed', findings: parsed.findings, keeps: parsed.keeps?.trim() || null, model: REVIEW_MODEL, sheets: sheets.length };
}
