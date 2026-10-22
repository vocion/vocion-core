/**
 * TEACHING A ROUTINE: the Routine analyst reads a Slate recording — what was
 * said, when, what was on screen, and frames at the moments that matter — and
 * drafts the routine's spec: steps linked to their moments, the rules the
 * specialist said, where it must escalate to the expert, what it must never
 * do, its inputs and the outputs it reads back, and the questions one example
 * cannot settle. It authorizes nothing: the expert approves the spec.
 *
 * A video does not reveal selectors or hidden state, so the spec names what a
 * person sees (button and field names, pages), and the browser run finds them
 * on the page each time.
 */

import type { RoutineInputSpec, RoutineOutputSpec, RoutineQuestion, RoutineSpec, RoutineWrite } from '@/libs/routines/types';
import type { SlateFrame, SlateRecording } from '@/libs/slate/recording';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
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

const SYSTEM = `You are the Routine analyst. A specialist recorded themselves doing a piece of repeatable work in a web app, narrating why each step happens. From the recording — the transcript with timestamps, what was on screen, and frames at key moments — you write the routine's spec: what a browser, run by an AI, must do to repeat this work for any row of inputs, exactly as the specialist does it.

Write it as JSON only, no prose around it, in this shape:
{
  "name": "Short imperative name of the work, e.g. \\"Add a user and enroll them in a campaign\\"",
  "description": "One sentence: what the routine does and for whom.",
  "summary": "Two or three sentences a person reads first.",
  "startUrl": "The address the work starts at, from what was on screen (null if not seen)",
  "systems": ["hosts it uses"],
  "inputs": [{ "name": "snake_case", "description": "what it is", "example": "value from the recording", "secret": false, "key": false, "optional": false, "shared": false }],
  "outputs": [{ "name": "snake_case", "description": "what the run reads back from the saved record", "checks": "the input name this must equal after saving, or null" }],
  "preconditions": ["what must be true before it starts"],
  "steps": [{ "n": 1, "text": "Imperative step, naming what a person sees (the button, the field, the page)", "why": "why the specialist does it", "at": 12 }],
  "rules": [{ "text": "A rule the specialist said, as an instruction", "at": 40 }],
  "escalations": [{ "when": "the situation", "ask": "what to ask the expert", "at": 55 }],
  "prohibited": ["things the run must never do"],
  "postconditions": ["what must be true when it is done"],
  "writes": [{ "button": "Exact name of a button that saves a change, as seen on screen", "host": null }],
  "reconcile": { "listUrl": "address of the page that lists every record of the kind this work adds (e.g. all users), or null", "how": "how to read the whole list (search, pages, columns)", "matchOn": "the input that identifies a record in that list, e.g. email" },
  "questions": [{ "question": "something one example cannot settle", "why": "why it matters", "at": 30 }],
  "manualMinutes": 3.5
}

How to write it:
- "at" is seconds on the recording where the step or rule appears, from the transcript timestamps. Every step and rule has one when it was shown or said.
- Inputs are what changes from one run to the next (the person's name, email, department, the campaign). Mark the sign-in password "secret": true. Mark inputs every row of a batch shares (the sign-in email and password, the campaign) "shared": true. Mark the inputs that identify one piece of work (e.g. the email) "key": true, so the same work is never done twice.
- The run signs in with the inputs when the site asks; include a sign-in step only as "Sign in with the account given, if asked".
- Outputs must include what proves the work was done, read back from the saved record after saving (e.g. the user's email and the campaign as the record shows them), each with "checks" naming the input it must match. Include an output for the record's id or reference when the app shows one.
- Writes are only the buttons that save the work, by their exact on-screen name ("Add user", "Enroll"). Never include buttons that delete, deactivate, send, launch or pay unless the work itself is that.
- Escalate where the specialist said to check something or said "never": a person who may already exist under another email (a possible duplicate), someone already done, anything that does not match. The run asks the expert instead of guessing.
- Prohibited: what the specialist said never to do, plus deleting or deactivating records, sending emails the work did not send, and changing anything outside the inputs.
- If the work adds records to a list (users, contacts, members), fill "reconcile" so a batch can compare the whole list with the rows it was given; otherwise null.
- Questions: two or three that one example cannot settle and that change what the run does (what counts as a duplicate, what to do when someone is already enrolled, a default for a field). Never ask what the recording already answers.
- manualMinutes: how long one run takes a person by hand, from the recording's length and pace.
- Use only what the recording shows or says. A value you cannot see is null.`;

type Raw = Record<string, unknown>;

const str = (v: unknown, max = 600): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => Boolean(x) && typeof x === 'object' && !Array.isArray(x)) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => str(x)).filter(Boolean) : []);

function snake(s: string): string {
  return s.trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/\W+/g, '_').replace(/^_+|_+$/g, '').toLowerCase().slice(0, 40) || 'value';
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
  })).filter((i, n, all) => all.findIndex(x => x.name === i.name) === n);
  const names = new Set(inputs.map(i => i.name));
  const outputs: RoutineOutputSpec[] = list(raw.outputs).map(o => ({
    name: snake(str(o.name, 40)),
    description: str(o.description, 300),
    checks: names.has(snake(str(o.checks, 40))) ? snake(str(o.checks, 40)) : null,
  })).filter((o, n, all) => o.name && all.findIndex(x => x.name === o.name) === n);
  const writes: RoutineWrite[] = list(raw.writes).map(w => ({ button: str(w.button, 80), host: str(w.host, 200) || null })).filter(w => w.button);
  const rec = raw.reconcile && typeof raw.reconcile === 'object' ? raw.reconcile as Raw : null;
  const questions: RoutineQuestion[] = list(raw.questions).slice(0, 5).map((q, i) => ({ id: `q${i + 1}`, question: str(q.question, 400), why: str(q.why, 300) || null, at: num(q.at), answer: null, answeredBy: null })).filter(q => q.question);
  const spec: RoutineSpec = {
    summary: str(raw.summary, 800),
    startUrl: str(raw.startUrl, 2000) || null,
    systems: strings(raw.systems).slice(0, 8),
    inputs,
    outputs,
    preconditions: strings(raw.preconditions).slice(0, 10),
    steps: list(raw.steps).map(st => ({ text: str(st.text, 400), why: str(st.why, 300) || null, at: num(st.at) })).filter(st => st.text).slice(0, 40).map((st, i) => ({ n: i + 1, ...st })),
    rules: list(raw.rules).slice(0, 20).map(r => ({ text: str(r.text, 400), at: num(r.at) })).filter(r => r.text),
    escalations: list(raw.escalations).slice(0, 10).map(e => ({ when: str(e.when, 300), ask: str(e.ask, 300), at: num(e.at) })).filter(e => e.when),
    prohibited: strings(raw.prohibited).slice(0, 12),
    postconditions: strings(raw.postconditions).slice(0, 10),
    writes,
    reconcile: rec && (str(rec.listUrl) || str(rec.how)) ? { listUrl: str(rec.listUrl, 2000) || null, how: str(rec.how, 600), matchOn: snake(str(rec.matchOn, 40) || 'email') } : null,
    questions,
    manualMinutes: num(raw.manualMinutes),
  };
  return { name: str(raw.name, 120) || 'Untitled routine', description: str(raw.description, 400), spec };
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

/**
 * Draft a routine from a recording. One model call with the frames; once more if the reply was not
 * a usable spec.
 * @param orgId - The workspace (its model, its spend).
 * @param rec - The recording.
 * @param frames - Frames at the moments `framesToRead` chose.
 * @param hints - What the person said about it.
 * @param hints.name - The name they gave it.
 * @param hints.note - Anything they added.
 */
export async function draftSpec(orgId: string, rec: SlateRecording, frames: SlateFrame[], hints: { name?: string | null; note?: string | null }): Promise<{ name: string; description: string; spec: RoutineSpec }> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { chargeModelCall } = await import('@/services/budget/chargeModelCall');
  const model = await buildChatModelForOrg('main', orgId, { temperature: 0, streaming: false, maxTokens: 8_000, thinking: 'off' });
  const transcript = rec.transcript.map(l => `[${clock(l.at)}] ${l.text}`).join('\n').slice(0, 40_000);
  const activity = rec.activity.map(a => `[${clock(a.at)}] ${[a.app, a.title, a.url].filter(Boolean).join(' · ')}`).join('\n').slice(0, 8_000);
  const pages = rec.video.pages.map(p => `[${clock(p.at)}] ${[p.title, p.url].filter(Boolean).join(' · ')}`).join('\n').slice(0, 4_000);
  const intro = [
    `Recording: ${rec.video.title ?? 'untitled'} (${rec.video.durationSec ? `${Math.round(rec.video.durationSec)} s` : 'length unknown'})${rec.video.recordedBy ? `, recorded by ${rec.video.recordedBy}` : ''}.`,
    rec.video.summary ? `Slate's summary: ${rec.video.summary}` : '',
    hints.name ? `The person calls this routine: ${hints.name}` : '',
    hints.note ? `They added: ${hints.note}` : '',
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
    const response = await model.invoke(attempt === 0 ? messages : [...messages, new HumanMessage('Reply with the JSON object only.')]);
    await chargeModelCall({ orgId, feature: 'routines.teach', role: 'main', response }).catch(() => {});
    const raw = jsonIn(contentText(response.content));
    if (raw) {
      const out = normalizeSpec(raw);
      if (out.spec.steps.length > 0) {
        return { ...out, name: hints.name?.trim() || out.name };
      }
    }
  }
  throw new Error('the analyst could not write a spec from this recording');
}

/**
 * What every run of a version is told: the spec as a briefing, in order.
 * @param name - The routine.
 * @param spec - Its spec.
 */
export function compileTask(name: string, spec: RoutineSpec): string {
  const answered = spec.questions.filter(q => q.answer);
  return [
    `Do the routine “${name}” for the one row of inputs given. ${spec.summary}`,
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
 * step that runs the routine for them (`routine.run`). Approvals are the routine's own trust level.
 * @param slug - The routine.
 * @param name - Its name.
 * @param n - The version.
 * @param spec - Its spec.
 */
export function workflowYamlFor(slug: string, name: string, n: number, spec: RoutineSpec): string {
  const props = spec.inputs.filter(i => !i.secret).map(i => `          ${i.name}: { type: string, description: ${yamlString(i.description)} }`).join('\n');
  return [
    `# workflows/${slug}/workflow.yaml — generated from routine “${name}” v${n}.`,
    `# Each row runs as a browser run under the routine's approved version and trust level.`,
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
    '  - name: run-routine',
    '    type: action',
    '    action: routine.run',
    '    input:',
    `      routine: ${slug}`,
    `      version: ${n}`,
    '      rows: \'{{input.rows}}\'',
    '',
  ].join('\n');
}
