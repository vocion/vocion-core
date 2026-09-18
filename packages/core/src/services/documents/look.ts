/**
 * The look — an agent reading the rendered sheets the way a person would.
 *
 * The numeric audit catches what geometry can prove: a footer that moved, a
 * body that overflows, a PDF page that split. It cannot see a Gantt bar on
 * the wrong week, a quote attribution sitting on the footer rule, or a chip
 * whose text went invisible against its own background. Those need eyes, so
 * the sheet PNGs go to a vision model with one question: what would a client
 * notice? Findings come back as sentences naming the sheet, and join the
 * verification's issues under their own class (`look:`), so a person can tell
 * a measured fact from a model's reading (design principle 2).
 *
 * Same key discipline as `kitVision`: the org's stored Anthropic key first,
 * the server's otherwise, built per call. No key at all means the look is
 * skipped and says so — never a guess dressed as a finding.
 */

import type { Buffer } from 'node:buffer';
import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { z } from 'zod';
import { resolveOrgProviderKey } from '@/libs/llm/orgKey';

const LOOK_MODEL = process.env.VOCION_VISION_MODEL ?? 'claude-sonnet-4-6';
/** Sheets are 816×1056 at 1×; half-size is plenty to read layout and costs a quarter of the tokens. */
const LOOK_WIDTH = 612;
const MAX_SHEETS_PER_LOOK = 16;

const FindingsSchema = z.object({
  findings: z.array(z.object({
    sheet: z.number().int().positive(),
    finding: z.string().min(1).max(300),
  })).max(40),
});

export type LookOutcome
  = | { status: 'looked'; findings: Array<{ sheet: number; finding: string }>; model: string }
    | { status: 'skipped'; reason: string };

const SYSTEM = [
  'You review print-ready US-Letter proposal sheets rendered from HTML, the way a careful designer proofs a PDF before it goes to a client.',
  'Report only what a client would notice: text or elements cut off at a sheet edge, content colliding with the footer rule, invisible or near-invisible text, overlapping elements, a chart bar or Gantt bar that plainly sits in the wrong column, an empty or near-empty sheet, a broken image placeholder, or a stray placeholder marker.',
  'Do NOT comment on copy, tone, pricing, or design taste. Do NOT restate that a sheet looks fine.',
  'Return STRICT JSON and nothing else: {"findings":[{"sheet":<n>,"finding":"<one sentence>"}]}. An empty findings array is a valid answer.',
].join(' ');

/**
 * Look at rendered sheets and return what a client would notice.
 * @param orgId
 * @param sheets - Sheet number and PNG bytes, in order.
 */
export async function lookAtSheets(orgId: string, sheets: ReadonlyArray<{ n: number; label: string; png: Buffer }>): Promise<LookOutcome> {
  const apiKey = await resolveOrgProviderKey('anthropic', orgId) ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { status: 'skipped', reason: 'no Anthropic key is configured for this workspace or the server' };
  }
  const chosen = sheets.slice(0, MAX_SHEETS_PER_LOOK);
  if (chosen.length === 0) {
    return { status: 'skipped', reason: 'no sheet images to look at' };
  }
  const content: Anthropic.ContentBlockParam[] = [];
  for (const s of chosen) {
    const small = await sharp(s.png).resize({ width: LOOK_WIDTH }).png().toBuffer();
    content.push({ type: 'text', text: `Sheet ${s.n}${s.label ? ` — ${s.label}` : ''}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: small.toString('base64') } });
  }
  content.push({ type: 'text', text: `${chosen.length} sheets shown${sheets.length > chosen.length ? ` (of ${sheets.length})` : ''}. Return the JSON now.` });
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({ model: LOOK_MODEL, max_tokens: 2000, temperature: 0, system: SYSTEM, messages: [{ role: 'user', content }] });
  const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    const parsed = FindingsSchema.parse(JSON.parse(text.slice(start, end + 1)));
    return { status: 'looked', findings: parsed.findings, model: LOOK_MODEL };
  } catch {
    return { status: 'skipped', reason: 'the vision model returned something other than the findings JSON' };
  }
}
