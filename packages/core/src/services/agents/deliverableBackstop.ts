/**
 * The DELIVERABLE backstop — what guarantees a turn sent with
 * `deliverable: 'artifact'` ends with an artifact.
 *
 * The contract (`libs/chat/deliverable.ts`) says what the turn owes. This says
 * what happens when the loop does not pay it, in the repo's order of strength
 * (CLAUDE.md, *Structural over prompting*):
 *
 *   1. **Deterministic post-processing.** The answer is already a document —
 *      it has headings, or a markdown table, or is simply long — so wrap it
 *      verbatim into a markdown artifact. No model, no second opinion, and
 *      nothing invented: what the person reads in the pane is exactly what the
 *      agent wrote.
 *   2. **One gated model pass.** The answer is short (the narration case: "I'll
 *      pull the full picture before drafting…" and then nothing). There is no
 *      document to wrap, so one focused pass over the turn's transcript and
 *      tool results produces either the document or an explicit stub naming
 *      what failed and what is needed. Same shape as
 *      `harnessConfig.recommendActionBackstop` in AgentService: fires only on
 *      violation, never on the happy path.
 *
 * **A stub is a legitimate artifact; a silent nothing is not.** When the work
 * could not be done, the pane says so, in the pane, where the person was
 * looking — rather than leaving a "Tool error" badge and an empty column.
 *
 * Either branch appends ONE sentence to the answer saying an artifact was
 * created and why, because an artifact that appears with no explanation is
 * indistinguishable from one the agent decided to make on its own.
 *
 * Runs for every harness target: it reads the turn's finished text and tool
 * calls, which all four providers return, so the guarantee does not depend on
 * where the loop executed.
 */

import type { AgentEvent } from './types';
import type { Deliverable } from '@/libs/chat/deliverable';
import { createArtifact, toPayload } from '@/services/ArtifactService';

/** Tool names that mean "this turn already produced or changed an artifact". */
export const ARTIFACT_TOOLS: ReadonlySet<string> = new Set([
  'render_table',
  'render_markdown',
  'render_chart',
  'render_record',
  'create_artifact',
  'update_artifact',
]);

/** At or above this word count an answer is a document, whatever else it has. */
const LONG_FORM_WORDS = 120;

const HEADING_RE = /^#{1,6}\s+\S/m;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

/**
 * Did this turn call a tool that creates or changes an artifact?
 * @param toolCalls
 */
export function renderedAnArtifact(toolCalls: ReadonlyArray<{ tool: string }>): boolean {
  return toolCalls.some(c => ARTIFACT_TOOLS.has(c.tool));
}

/**
 * Is this answer already a document — something worth keeping beside the
 * conversation rather than scrolling past?
 *
 * Three independent signals, any one of which is enough: markdown headings, a
 * markdown table (a header row plus a separator row), or sheer length. Pure,
 * so the wrap branch is testable with no database and no model.
 * @param text - The answer the turn produced.
 */
export function isLongForm(text: string): boolean {
  const body = (text ?? '').trim();
  if (body.length === 0) {
    return false;
  }
  if (HEADING_RE.test(body)) {
    return true;
  }
  const lines = body.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (TABLE_ROW_RE.test(lines[i]!) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      return true;
    }
  }
  return body.split(/\s+/).filter(Boolean).length >= LONG_FORM_WORDS;
}

/**
 * A short, human title for what was asked for: the request with its politeness
 * and its make-verb taken off, capped. "draft a pipeline report" → "Pipeline
 * report". Falls back to a neutral label rather than an empty string.
 * @param request - The person's message for this turn.
 */
export function subjectOf(request: string): string {
  const raw = (request ?? '').split('\n')[0]?.trim() ?? '';
  const cleaned = raw
    .replace(/^(?:hey\s+|hi\s+|ok(?:ay)?[,\s]+)?(?:please\s+|pls\s+)?(?:(?:can|could|would|will)\s+you\s+|i\s+(?:need|want)\s+(?:you\s+to\s+)?)?/i, '')
    .replace(/^(?:draft|write\s+up|write|build|generate|create|produce|put\s+together|pull\s+together|make\s+me|make|compose|prepare|assemble|outline|spin\s+up)\s+/i, '')
    .replace(/^(?:a|an|the|me\s+a|me\s+an|us\s+a|us\s+an)\s+/i, '')
    .replace(/[?!.\s]+$/, '')
    .trim();
  const subject = cleaned.length > 0 ? cleaned : 'Requested document';
  const capped = subject.length > 80 ? `${subject.slice(0, 77).trimEnd()}…` : subject;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

/**
 * The title to file a wrapped answer under: its first markdown heading when it
 * has one (that is what the agent called it), otherwise the request's subject.
 * @param text - The answer being wrapped.
 * @param request - The person's message for this turn.
 */
export function titleForWrapped(text: string, request: string): string {
  const heading = /^#{1,6}[ \t]+(\S.*)$/m.exec(text ?? '');
  const fromHeading = heading?.[1]?.replace(/[#*_`]/g, '').trim();
  if (fromHeading) {
    return fromHeading.length > 120 ? `${fromHeading.slice(0, 117).trimEnd()}…` : fromHeading;
  }
  return subjectOf(request);
}

/** One tool that failed during the turn, for the stub's "what failed" section. */
export type TurnFailure = { tool: string; message: string };

/**
 * The stub an artifact-owed turn leaves behind when the work did not happen.
 * Deterministic — it is also what the gated pass falls back to when the model
 * is unavailable or answers with something unusable.
 * @param request - The person's message for this turn.
 * @param failures - Tools that failed during the turn.
 */
export function buildStub(request: string, failures: ReadonlyArray<TurnFailure>): { title: string; md: string } {
  const subject = subjectOf(request);
  const title = `${subject} — not completed`;
  const what = failures.length > 0
    ? failures.map(f => `- \`${f.tool}\` failed: ${f.message.trim().slice(0, 300)}`)
    : ['- The turn produced no document and reported no specific failure.'];
  const needed = failures.length > 0
    ? [
        '- Re-run once the step above succeeds, or ask for the part that does not depend on it.',
        '- If it keeps failing, the failure is in the tool or the hand-off, not in the request.',
      ]
    : ['- Ask again, naming the sections you want, or narrow the scope to what is available.'];
  const md = [
    `# ${title}`,
    '',
    `Asked for: ${subject}.`,
    '',
    '## What failed',
    ...what,
    '',
    '## What is needed',
    ...needed,
  ].join('\n');
  return { title, md };
}

/** What the gated pass is asked to return, and what the stub satisfies. */
export type ComposedArtifact = { title: string; md: string };

export type DeliverableBackstopInput = {
  orgId: string;
  agentSlug?: string;
  userId?: string;
  conversationId?: number;
  /** What the turn was sent with. Anything but `artifact` is a no-op. */
  deliverable?: Deliverable;
  /** The person's message for this turn. */
  request: string;
  /** The answer the turn produced, already trimmed. */
  finalText: string;
  /** Every tool this turn called. */
  toolCalls: ReadonlyArray<{ tool: string; input?: Record<string, unknown>; output?: string }>;
  /** Tools that failed — the stub names them. */
  failures?: ReadonlyArray<TurnFailure>;
  /** The request emit, so the pane opens on what we just made. */
  emit: (event: AgentEvent) => void;
  /**
   * The gated pass. Injected so the short-answer branch is testable with no
   * model; the default (`composeWithModel`) is wired by the harness.
   */
  compose?: (ctx: { orgId: string; request: string; finalText: string; toolCalls: ReadonlyArray<{ tool: string; output?: string }>; systemPrompt?: string }) => Promise<ComposedArtifact | null>;
  /** The agent's own prompt, so the gated pass writes in its voice. */
  systemPrompt?: string;
};

export type DeliverableBackstopResult = {
  /** The artifact row that now exists. */
  artifactId: number;
  title: string;
  /** Which branch fired — `wrapped` is pure post-processing, `composed` used the gated pass. */
  branch: 'wrapped' | 'composed' | 'stub';
  /** The one sentence to append to the answer. */
  notice: string;
};

/**
 * Guarantee the artifact this turn owed.
 *
 * Returns `null` when nothing was owed or nothing was missing — the happy path
 * and the `answer` path both cost one set lookup and no IO.
 * @param input - See {@link DeliverableBackstopInput}.
 */
export async function runDeliverableBackstop(
  input: DeliverableBackstopInput,
): Promise<DeliverableBackstopResult | null> {
  if (input.deliverable !== 'artifact') {
    return null;
  }
  if (renderedAnArtifact(input.toolCalls)) {
    return null;
  }

  const text = (input.finalText ?? '').trim();
  let branch: DeliverableBackstopResult['branch'];
  let composed: ComposedArtifact;

  if (isLongForm(text)) {
    // Deterministic: the answer IS the document. Wrap it verbatim.
    branch = 'wrapped';
    composed = { title: titleForWrapped(text, input.request), md: text };
  } else {
    const fromModel = input.compose
      ? await input.compose({
          orgId: input.orgId,
          request: input.request,
          finalText: text,
          toolCalls: input.toolCalls,
          systemPrompt: input.systemPrompt,
        }).catch(() => null)
      : null;
    if (fromModel && fromModel.md.trim().length > 0) {
      branch = 'composed';
      composed = { title: fromModel.title.trim() || subjectOf(input.request), md: fromModel.md };
    } else {
      branch = 'stub';
      composed = buildStub(input.request, input.failures ?? []);
    }
  }

  const changeSummary = branch === 'wrapped'
    ? 'Captured from the turn\'s answer because an artifact was requested and none was rendered'
    : branch === 'composed'
      ? 'Composed from the turn because an artifact was requested and none was rendered'
      : 'Stub recorded because an artifact was requested and the turn could not produce one';

  const { artifact } = await createArtifact({
    orgId: input.orgId,
    conversationId: input.conversationId ?? null,
    kind: 'markdown',
    title: composed.title,
    spec: { title: composed.title, md: composed.md },
    // `system`, not `agent`: the harness made this, not the agent's own
    // judgement, and the version history should not claim otherwise.
    author: { kind: 'system', id: input.agentSlug ? `agent:${input.agentSlug}` : null },
    changeSummary,
  });
  input.emit({ type: 'artifact', artifact: toPayload(artifact) });

  return { artifactId: artifact.id, title: artifact.title, branch, notice: noticeFor(branch, artifact.title) };
}

/**
 * The one sentence appended to the answer. Plain, and it says WHY — an
 * artifact that appears unannounced reads as the agent having decided to make
 * one, which is exactly the ambiguity this whole mechanism removes.
 * @param branch - Which backstop branch fired.
 * @param title - The artifact's title.
 */
export function noticeFor(branch: DeliverableBackstopResult['branch'], title: string): string {
  if (branch === 'stub') {
    return `You asked for an artifact and this turn could not produce one, so I filed a stub beside the conversation — "${title}" — recording what failed and what is needed.`;
  }
  if (branch === 'wrapped') {
    return `You asked for an artifact, so I kept this answer beside the conversation as "${title}" — edit it there rather than asking for the whole thing again.`;
  }
  return `You asked for an artifact and none was rendered during the turn, so I wrote one beside the conversation — "${title}".`;
}

/**
 * The gated pass, wired to the org's own main model.
 *
 * Fires only on the short-answer branch of a violated contract, so the cost is
 * bounded by how often the loop fails to honour the chip. It is handed the
 * turn's transcript and tool results and asked for ONE of two things: the
 * document, or an explicit stub. It is told, in as many words, not to invent
 * data — a fabricated pipeline report is worse than a stub that says the
 * numbers could not be read.
 *
 * Never throws: the caller falls back to {@link buildStub}, which is the same
 * shape without the model.
 * @param ctx - The turn, as {@link DeliverableBackstopInput.compose} supplies it.
 * @param ctx.orgId - Tenant whose key and model this pass spends.
 * @param ctx.request - The person's message for this turn.
 * @param ctx.finalText - Whatever answer the turn produced.
 * @param ctx.toolCalls - The turn's tool calls and their outputs.
 * @param ctx.systemPrompt - The agent's own prompt, for voice.
 */
export async function composeArtifactWithModel(ctx: {
  orgId: string;
  request: string;
  finalText: string;
  toolCalls: ReadonlyArray<{ tool: string; output?: string }>;
  systemPrompt?: string;
}): Promise<ComposedArtifact | null> {
  const { buildChatModelForOrg } = await import('@/libs/llm');
  const { HumanMessage, SystemMessage } = await import('@langchain/core/messages');
  const model = await buildChatModelForOrg('main', ctx.orgId, { temperature: 0, streaming: false, maxTokens: 4000 });

  const evidence = ctx.toolCalls
    .slice(-12)
    .map(c => `### ${c.tool}\n${(c.output ?? '').slice(0, 2000)}`)
    .join('\n\n') || '(no tool produced any output this turn)';

  const sys = [
    ctx.systemPrompt ?? '',
    '',
    'DELIVERABLE BACKSTOP PASS. The person asked for an ARTIFACT — a document they keep beside the conversation — and the turn ended without one. Your only job is to produce that document now, from the transcript and tool results below.',
    'Return STRICT JSON and nothing else: {"title": "<short title>", "md": "<markdown body>"}.',
    'NEVER invent data. If the work did not actually happen — the tools failed, the hand-off failed, nothing was retrieved — do NOT write a plausible-looking document. Write a stub instead: title it "<subject> — not completed" and let the body say, in two short sections, what failed and what is needed. A stub is a legitimate artifact; a fabricated one is not.',
  ].filter(Boolean).join('\n');

  const human = [
    `The person asked: ${ctx.request}`,
    '',
    `What the agent said (all of it): ${ctx.finalText || '(nothing)'}`,
    '',
    'Tool results from this turn:',
    evidence,
  ].join('\n');

  const res = await model.invoke(
    [new SystemMessage(sys), new HumanMessage(human)],
    { signal: AbortSignal.timeout(45_000) },
  );
  const raw = typeof res.content === 'string'
    ? res.content
    : (res.content as Array<{ type?: string; text?: string }>)
        .map(b => (b?.type === 'text' ? b.text ?? '' : ''))
        .join('');
  return parseComposed(raw);
}

/**
 * Pull `{title, md}` out of whatever the model returned — bare JSON, or JSON in
 * a fence, which models produce roughly half the time. Returns null for
 * anything unusable so the caller falls back to the deterministic stub.
 * @param raw - The model's reply text.
 */
export function parseComposed(raw: string): ComposedArtifact | null {
  const text = (raw ?? '').trim();
  if (!text) {
    return null;
  }
  const fenced = /```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)```/.exec(text)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as { title?: unknown; md?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const md = typeof parsed.md === 'string' ? parsed.md.trim() : '';
    return md ? { title, md } : null;
  } catch {
    return null;
  }
}
