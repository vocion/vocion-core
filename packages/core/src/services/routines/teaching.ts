/**
 * TEACHING A ROUTINE: the Routine analyst reads a Slate recording — what was
 * said, when, what was on screen, and frames at the moments that matter — and
 * drafts the automation's spec: steps linked to their moments, the rules the
 * specialist said, where it must escalate to the expert, what it must never
 * do, its inputs and the outputs it reads back, and the questions one example
 * cannot settle. It authorizes nothing: the expert approves the spec.
 *
 * A video does not reveal selectors or hidden state, so the spec names what a
 * person sees (button and field names, pages), and the browser run finds them
 * on the page each time.
 */

import type { RoutineFound, RoutineInputSpec, RoutineJudgment, RoutineOutputSpec, RoutineQuestion, RoutineRule, RoutineSite, RoutineSpec, RoutineStep, RoutineWrite } from '@/libs/routines/types';
import type { SlateFrame, SlateRecording } from '@/libs/slate/recording';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { parsePartialJson } from '@langchain/core/output_parsers';
import { clock } from '@/libs/routines/types';

/** Frames the analyst looks at, at most. */
const MAX_FRAMES = 8;

/** Words that mark a moment worth a frame: where something is clicked, checked, or decided. */
const MOMENT_WORDS = /\b(?:click|press|add|enroll|save|submit|search|check|look|find|select|choose|type|enter|duplicate|already|never|always|make sure|if|then|confirm|open|go to)\b/i;

/**
 * The moments to look at: the start, the moments the specialist names an action or a rule, and the
 * end; evenly spread when the transcript says little.
 * @param rec - The recording.
 */
export function framesToRead(rec: Pick<SlateRecording, 'transcript' | 'video'>): number[] {
  const duration = rec.video.durationSec ?? (rec.transcript.at(-1)?.at ?? 60) + 5;
  const picked: number[] = [Math.min(2, duration)];
  for (const line of rec.transcript) {
    if (MOMENT_WORDS.test(line.text) && picked.every(p => Math.abs(p - line.at) > 6)) {
      picked.push(line.at + 1.5);
    }
  }
  picked.push(Math.max(0, duration - 2));
  let chosen = [...new Set(picked.map(x => Math.round(Math.min(Math.max(0, x), duration))))].sort((a, b) => a - b);
  if (chosen.length > MAX_FRAMES) {
    const step = (chosen.length - 1) / (MAX_FRAMES - 1);
    chosen = Array.from({ length: MAX_FRAMES }, (_, i) => chosen[Math.round(i * step)]!);
  }
  if (chosen.length < 4 && duration > 20) {
    chosen = Array.from({ length: 6 }, (_, i) => Math.round((duration * (i + 0.5)) / 6));
  }
  return [...new Set(chosen)];
}

const SYSTEM = `You are the Automation analyst. A specialist recorded themselves doing a piece of repeatable work in a web app, narrating why each step happens. From the recording — the transcript with timestamps, what was on screen, and frames at key moments — you write the automation's spec: what a browser, run by an AI, must do to repeat this work for any row of inputs, exactly as the specialist does it.

Write it as JSON only, no prose around it, in this shape and in this order (what you found in the recording first, then what a run needs):
{
  "name": "Short imperative name of the work, e.g. \\"Add a user and enroll them in a campaign\\"",
  "description": "One sentence: what the automation does and for whom.",
  "summary": "Two or three sentences a person reads first.",
  "startUrl": "The address the work starts at, from what was on screen (null if not seen)",
  "sites": [{ "name": "The system or site the work moves into, as a person names it", "url": "its address, or null if not seen", "at": 36 }],
  "steps": [{ "n": 1, "text": "Imperative step, naming what a person sees (the button, the field, the page)", "why": "why the specialist does it", "at": 12 }],
  "rules": [{ "text": "A rule the specialist said, as an instruction", "at": 40 }],
  "judgments": [{ "text": "Where the specialist looked at something and decided, and what they decided on", "at": 50 }],
  "escalations": [{ "when": "the situation", "ask": "what to ask the expert", "at": 55 }],
  "questions": [{ "question": "something one example cannot settle", "why": "why it matters", "at": 30 }],
  "systems": ["hosts it uses"],
  "inputs": [{ "name": "snake_case", "description": "what it is", "example": "value from the recording", "secret": false, "key": false, "optional": false, "shared": false, "file": false }],
  "outputs": [{ "name": "snake_case", "description": "what the run reads back from the saved record", "checks": "the input name this must equal after saving, or null" }],
  "preconditions": ["what must be true before it starts"],
  "prohibited": ["things the run must never do"],
  "postconditions": ["what must be true when it is done"],
  "writes": [{ "button": "Exact name of a button that saves a change, as seen on screen", "host": null }],
  "reconcile": { "listUrl": "address of the page that lists every record of the kind this work adds (e.g. all users), or null", "how": "how to read the whole list (search, pages, columns)", "matchOn": "the input that identifies a record in that list, e.g. email" },
  "manualMinutes": 3.5
}

How to write it:
- "at" is seconds on the recording where the step or rule appears, from the transcript timestamps. Every site, step, rule, judgment and question has one when it was shown or said.
- Sites: each system or website the work moves into, in the order it came up (the work board, a lookup site, the application portal), at the moment it came up.
- Judgments: the moments the specialist checked something and chose what to do (a license is active so they go on, which form fits this kind of provider), in their order.
- Inputs are what changes from one run to the next (the person's name, email, department, the campaign). Mark the sign-in password "secret": true. Mark inputs every row of a batch shares (the sign-in email and password, the campaign) "shared": true. Mark the inputs that identify one piece of work (e.g. the email) "key": true, so the same work is never done twice. A document the work uploads (a roster, a tax form, a signed letter) is an input with "file": true: the run attaches it from the workspace, never retypes it.
- The run signs in with the inputs when the site asks; include a sign-in step only as "Sign in with the account given, if asked".
- Outputs must include what proves the work was done, read back from the saved record after saving (e.g. the user's email and the campaign as the record shows them), each with "checks" naming the input it must match. Include an output for the record's id or reference when the app shows one.
- Writes are only the buttons that save the work, by their exact on-screen name ("Add user", "Enroll"). Never include buttons that delete, deactivate, send, launch or pay unless the work itself is that.
- Escalate where the specialist said to check something or said "never": a person who may already exist under another email (a possible duplicate), someone already done, anything that does not match. The run asks the expert instead of guessing.
- Prohibited: what the specialist said never to do, plus deleting or deactivating records, sending emails the work did not send, and changing anything outside the inputs.
- If the work adds records to a list (users, contacts, members), fill "reconcile" so a batch can compare the whole list with the rows it was given; otherwise null.
- Questions: two or three that one example cannot settle and that change what the run does (what counts as a duplicate, what to do when someone is already enrolled, a default for a field). Never ask what the recording already answers.
- manualMinutes: how long one run takes a person by hand, from the recording's length and pace.
- Cover every path the specialist names, not only the one shown: when they say what they do if the person already exists, is already enrolled, or a field is missing, the steps say what to do then (e.g. "If a user already has that email, do not add one: open their page and go on to enroll").
- Use only what the recording shows or says. A value you cannot see is null.`;

/** The question the analyst adds when the recording does not show where the work starts. */
export const START_QUESTION = 'start';

type Raw = Record<string, unknown>;

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => Boolean(x) && typeof x === 'object' && !Array.isArray(x)) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => str(x)).filter(Boolean) : []);

function snake(s: string): string {
  return s.trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\W+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 40) || 'value';
}

const stepsOf = (raw: Raw): RoutineStep[] => list(raw.steps).map(st => ({ text: str(st.text, 400), why: str(st.why, 300) || null, at: num(st.at) })).filter(st => st.text).slice(0, 40).map((st, i) => ({ n: i + 1, ...st }));
const rulesOf = (raw: Raw): RoutineRule[] => list(raw.rules).slice(0, 20).map(r => ({ text: str(r.text, 400), at: num(r.at) })).filter(r => r.text);
const judgmentsOf = (raw: Raw): RoutineJudgment[] => list(raw.judgments).slice(0, 20).map(j => ({ text: str(j.text, 400), at: num(j.at) })).filter(j => j.text);
const sitesOf = (raw: Raw): RoutineSite[] => list(raw.sites).slice(0, 12).map(x => ({ name: str(x.name, 200), url: str(x.url, 2000) || null, at: num(x.at) })).filter(x => x.name);
const questionsOf = (raw: Raw): RoutineQuestion[] => list(raw.questions).slice(0, 5).map((q, i) => ({ id: `q${i + 1}`, question: str(q.question, 400), why: str(q.why, 300) || null, at: num(q.at), answer: null, answeredBy: null })).filter(q => q.question);

/** The arrays of the analyst's reply that are findings in the recording, in the order the reply writes them. */
const FOUND_KEYS = ['sites', 'steps', 'rules', 'judgments', 'questions'] as const;

/**
 * What the analyst has found so far, from its reply as written up to now: the sites, steps, rules,
 * judgment calls and questions it has finished writing. An entry still being written is left for
 * the next read; a list is finished once the reply has moved on past it.
 * @param text - The reply so far.
 */
export function foundSoFar(text: string): RoutineFound {
  const raw = (partialJson(text) ?? {}) as Raw;
  const keys = Object.keys(raw);
  const done: Raw = {};
  for (const k of FOUND_KEYS) {
    const v = raw[k];
    if (!Array.isArray(v)) {
      continue;
    }
    // The last entry is finished once a later key has begun, or the whole reply parses.
    const closed = keys.indexOf(k) < keys.length - 1 || jsonIn(text) !== null;
    done[k] = closed ? v : v.slice(0, -1);
  }
  return { sites: sitesOf(done), steps: stepsOf(done), rules: rulesOf(done), judgments: judgmentsOf(done), questions: questionsOf(done) };
}

function partialJson(text: string): unknown {
  const from = text.indexOf('{');
  if (from < 0) {
    return null;
  }
  // From the first brace to a closing fence, if the reply is fenced.
  return parsePartialJson(text.slice(from).split('```')[0]!);
}

/**
 * The analyst's JSON as a spec: every field typed, numbered and bounded, whatever it wrote.
 * @param raw - The model's object.
 */
export function normalizeSpec(raw: Raw): { name: string; description: string; spec: RoutineSpec } {
  const inputs: RoutineInputSpec[] = list(raw.inputs).map(i => ({
    name: snake(str(i.name, 40)),
    description: str(i.description, 300),
    example: str(i.example, 300) || null,
    ...(i.secret === true ? { secret: true } : {}),
    ...(i.key === true ? { key: true } : {}),
    ...(i.optional === true ? { optional: true } : {}),
    ...(i.shared === true || i.secret === true ? { shared: true } : {}),
    ...(i.file === true && i.secret !== true ? { file: true } : {}),
  })).filter((i, n, all) => all.findIndex(x => x.name === i.name) === n);
  const names = new Set(inputs.map(i => i.name));
  const outputs: RoutineOutputSpec[] = list(raw.outputs).map(o => ({
    name: snake(str(o.name, 40)),
    description: str(o.description, 300),
    checks: names.has(snake(str(o.checks, 40))) ? snake(str(o.checks, 40)) : null,
  })).filter((o, n, all) => o.name && all.findIndex(x => x.name === o.name) === n);
  const writes: RoutineWrite[] = list(raw.writes).map(w => ({ button: str(w.button, 80), host: str(w.host, 200) || null })).filter(w => w.button);
  const rec = raw.reconcile && typeof raw.reconcile === 'object' ? raw.reconcile as Raw : null;
  const questions = questionsOf(raw);
  const judgments = judgmentsOf(raw);
  const sites = sitesOf(raw);
  const spec: RoutineSpec = {
    summary: str(raw.summary, 800),
    startUrl: str(raw.startUrl, 2000) || null,
    systems: strings(raw.systems).slice(0, 8),
    inputs,
    outputs,
    preconditions: strings(raw.preconditions).slice(0, 10),
    steps: stepsOf(raw),
    rules: rulesOf(raw),
    escalations: list(raw.escalations).slice(0, 10).map(e => ({ when: str(e.when, 300), ask: str(e.ask, 300), at: num(e.at) })).filter(e => e.when),
    // Kept when the analyst wrote the list at all, even empty: an empty list is an answer.
    ...(Array.isArray(raw.judgments) ? { judgments } : {}),
    ...(Array.isArray(raw.sites) ? { sites } : {}),
    prohibited: strings(raw.prohibited).slice(0, 12),
    postconditions: strings(raw.postconditions).slice(0, 10),
    writes,
    reconcile: rec && (str(rec.listUrl) || str(rec.how)) ? { listUrl: str(rec.listUrl, 2000) || null, how: str(rec.how, 600), matchOn: snake(str(rec.matchOn, 40) || 'email') } : null,
    questions,
    manualMinutes: num(raw.manualMinutes),
  };
  if (!spec.startUrl) {
    // A run cannot begin without an address, and a recording with no address bar does not show one.
    spec.questions.unshift({ id: START_QUESTION, question: 'What is the address (URL) the work starts at?', why: 'The recording does not show the address, and every run opens it first.', at: null, answer: null, answeredBy: null });
  }
  return { name: str(raw.name, 120) || 'Untitled automation', description: str(raw.description, 400), spec };
}

/**
 * A spec with what an answer settles written in: the start address from an answer that holds one.
 * @param spec - The spec, its questions already answered.
 */
export function settleAnswers(spec: RoutineSpec): RoutineSpec {
  const start = spec.questions.find(q => q.id === START_QUESTION)?.answer;
  const url = start ? /https?:\/\/[^\s)>"']+/i.exec(start)?.[0] : null;
  if (!url) {
    return spec;
  }
  let host: string | null = null;
  try {
    host = new URL(url).host;
  } catch {
    return spec;
  }
  return {
    ...spec,
    startUrl: url,
    systems: [...new Set([...spec.systems, host])],
  };
}

/**
 * The JSON object in a model's reply: the whole reply, a fenced block, or the outermost braces.
 * @param text - The reply.
 */
export function jsonIn(text: string): Raw | null {
  const parts = text.split('```');
  const fenced = parts.length >= 3 ? parts[1]!.replace(/^json\b/i, '') : '';
  const tries = [text.trim(), fenced.trim(), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const t of tries) {
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Raw;
      }
    } catch { /* next */ }
  }
  return null;
}

function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(p => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '')).join('');
  }
  return '';
}

type Model = Awaited<ReturnType<typeof import('@/libs/llm').buildChatModelForOrg>>;
type Reply = { response: unknown; text: string };

async function whole(model: Model, messages: Parameters<Model['invoke']>[0]): Promise<Reply> {
  const response = await model.invoke(messages);
  return { response, text: contentText(response.content) };
}

/** How often, at most, what the analyst has found is handed on while it writes. */
const FOUND_EVERY_MS = 700;

/**
 * The analyst's reply as it is written: each time a finding is finished, `onFound` hears everything
 * found so far (at most every {@link FOUND_EVERY_MS}, and once more at the end).
 * @param model - The model.
 * @param messages - What it is asked.
 * @param onFound - Hears the findings.
 */
async function streamed(model: Model, messages: Parameters<Model['invoke']>[0], onFound: (found: RoutineFound) => void): Promise<Reply> {
  type Gathered = { concat?: (c: unknown) => unknown; content?: unknown };
  let gathered: Gathered | undefined;
  let text = '';
  let told = '';
  let last = 0;
  const tell = (force: boolean) => {
    if (!force && Date.now() - last < FOUND_EVERY_MS) {
      return;
    }
    const found = foundSoFar(text);
    const key = JSON.stringify(found);
    if (key !== told) {
      told = key;
      last = Date.now();
      onFound(found);
    }
  };
  for await (const chunk of await model.stream(messages)) {
    gathered = (gathered?.concat ? gathered.concat(chunk) : chunk) as Gathered;
    text += contentText((chunk as Gathered).content);
    tell(false);
  }
  tell(true);
  return { response: gathered ?? {}, text };
}

/**
 * Draft an automation from a recording. One model call with the frames; once more if the reply was not
 * a usable spec.
 * @param orgId - The workspace (its model, its spend).
 * @param rec - The recording.
 * @param frames - Frames at the moments `framesToRead` chose.
 * @param hints - What the person said about it.
 * @param hints.name - The name they gave it.
 * @param hints.note - Anything they added.
 * @param hints.startUrl - Where the work starts, when the person said.
 * @param onFound - Hears what the analyst has found so far while it writes; the model streams when given.
 */
export async function draftSpec(orgId: string, rec: SlateRecording, frames: SlateFrame[], hints: { name?: string | null; note?: string | null; startUrl?: string | null }, onFound?: (found: RoutineFound) => void): Promise<{ name: string; description: string; spec: RoutineSpec }> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
  const model = await buildChatModelForOrg('main', orgId, { temperature: 0, streaming: Boolean(onFound), maxTokens: 8_000, thinking: 'off' });
  const transcript = rec.transcript.map(l => `[${clock(l.at)}] ${l.text}`).join('\n').slice(0, 40_000);
  const activity = rec.activity.map(a => `[${clock(a.at)}] ${[a.app, a.title, a.url].filter(Boolean).join(' · ')}`).join('\n').slice(0, 8_000);
  const pages = rec.video.pages.map(p => `[${clock(p.at)}] ${[p.title, p.url].filter(Boolean).join(' · ')}`).join('\n').slice(0, 4_000);
  const intro = [
    `Recording: ${rec.video.title ?? 'untitled'} (${rec.video.durationSec ? `${Math.round(rec.video.durationSec)} s` : 'length unknown'})${rec.video.recordedBy ? `, recorded by ${rec.video.recordedBy}` : ''}.`,
    rec.video.summary ? `Slate's summary: ${rec.video.summary}` : '',
    hints.name ? `The person calls this automation: ${hints.name}` : '',
    hints.note ? `They added: ${hints.note}` : '',
    hints.startUrl ? `The work starts at: ${hints.startUrl}` : '',
    pages ? `Pages on screen:\n${pages}` : '',
    activity ? `What had focus, moment by moment:\n${activity}` : '',
    `Transcript:\n${transcript || '(no transcript)'}`,
    frames.length > 0 ? `Frames follow, at ${frames.map(f => clock(f.at)).join(', ')}.` : 'No frames could be read.',
  ].filter(Boolean).join('\n\n');
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: intro }];
  for (const f of frames) {
    content.push({ type: 'text', text: `Frame at ${clock(f.at)}:` });
    content.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.base64}` } });
  }
  const messages = [new SystemMessage(SYSTEM), new HumanMessage({ content: content as never })];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const asked = attempt === 0 ? messages : [...messages, new HumanMessage('Reply with the JSON object only.')];
    const { response, text } = onFound ? await streamed(model, asked, onFound) : await whole(model, asked);
    await chargeModelCall({ orgId, feature: 'routines.teach', role: 'main', response }).catch(() => {});
    const raw = jsonIn(text);
    if (raw) {
      const out = normalizeSpec(raw);
      if (out.spec.steps.length > 0) {
        if (hints.startUrl && !out.spec.startUrl) {
          out.spec.startUrl = hints.startUrl;
          out.spec.questions = out.spec.questions.filter(q => q.id !== START_QUESTION);
        }
        return { ...out, name: hints.name?.trim() || out.name };
      }
    }
  }
  throw new Error('the analyst could not write a spec from this recording');
}

/**
 * What every run of a version is told: the spec as a briefing, in order.
 * @param name - The automation.
 * @param spec - Its spec.
 */
export function compileTask(name: string, spec: RoutineSpec): string {
  const answered = spec.questions.filter(q => q.answer);
  return [
    `Do the automation “${name}” for the one row of inputs given. ${spec.summary}`,
    spec.preconditions.length > 0 ? `Before you start: ${spec.preconditions.join('; ')}.` : '',
    `Steps, in order:\n${spec.steps.map(s => `${s.n}. ${s.text}${s.why ? ` (${s.why})` : ''}`).join('\n')}`,
    answered.length > 0 ? `The expert settled:\n${answered.map(q => `- ${q.question} → ${q.answer}`).join('\n')}` : '',
    'Sign in with the account given whenever the site asks, then carry on where you were.',
    'When you finish, give every output as you read it back from the saved record, and set before to what the record looked like before you changed it (e.g. "No user with this email" or "User existed, not enrolled").',
  ].filter(Boolean).join('\n\n');
}

/**
 * The outputs every run owes: the spec's, and what the record was before.
 * @param outputs - The spec's outputs.
 */
export function runOutputs(outputs: RoutineOutputSpec[]): RoutineOutputSpec[] {
  return [...outputs, { name: 'before', description: 'What the record looked like before the change, in one sentence', checks: null }];
}

function yamlString(s: string): string {
  return JSON.stringify(s);
}

/**
 * The version as a workflow a workspace can keep: a manual trigger taking the rows, and one action
 * step that runs the automation for them (`routine.run`). Approvals are the automation's own trust level.
 * @param slug - The automation.
 * @param name - Its name.
 * @param n - The version.
 * @param spec - Its spec.
 */
export function workflowYamlFor(slug: string, name: string, n: number, spec: RoutineSpec): string {
  const props = spec.inputs.filter(i => !i.secret).map(i => `          ${i.name}: { type: string, description: ${yamlString(i.description)} }`).join('\n');
  return [
    `# workflows/${slug}/workflow.yaml — generated from automation “${name}” v${n}.`,
    `# Each row runs as a browser run under the automation's approved version and trust level.`,
    `slug: ${slug}`,
    `name: ${yamlString(name)}`,
    `description: ${yamlString(spec.summary.slice(0, 200))}`,
    `version: ${n}`,
    'trigger:',
    '  type: manual',
    'inputSchema:',
    '  type: object',
    '  properties:',
    '    rows:',
    '      type: array',
    '      items:',
    '        type: object',
    '        properties:',
    props || '          {}',
    'steps:',
    '  - name: run-automation',
    '    type: action',
    '    action: automation.run',
    '    input:',
    `      automation: ${slug}`,
    `      version: ${n}`,
    '      rows: \'{{input.rows}}\'',
    '',
  ].join('\n');
}
