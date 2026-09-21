import type { TraceActor, TraceCitation, TraceNodeEvent, TraceNodeKind } from './types';
/**
 * Typed trace emitter.
 *
 * Consumes raw LangChain `streamEvents(v2)` events and turns them into typed,
 * actor-attributed, nested `TraceNodeEvent`s — the hierarchical activity trace
 * the chat renders (reasoning, tool calls, skills, search+citations, and
 * delegation with the delegate's OWN work nested under it).
 *
 * Why this exists: the deepagents v3 `run.messages/.toolCalls/.subagents`
 * projection is FLAT — it exposes top-level tools + subagent start/end but
 * throws away everything a subagent does inside (its reasoning, its tools, its
 * citations). The raw v2 stream keeps that nesting in `metadata.checkpoint_ns`:
 *
 *   lead tool call        ns = "tools:<id>"                     (no '|')
 *   lead model turn       ns = "model_request:<id>"             (no '|')
 *   task (delegation)     ns = "tools:<taskId>"                 (no '|')
 *   subagent model turn   ns = "tools:<taskId>|model_request:…" (has '|')
 *   subagent tool call    ns = "tools:<taskId>|tools:<subId>"   (has '|')
 *
 * So: a ns containing '|' belongs to the specialist dispatched by the `task`
 * call whose id is the segment before the first '|'; otherwise it's the lead.
 * That `<taskId>` is also the delegation node's id, giving us parentId nesting.
 *
 * Pure + stateful but deterministic: feed it recorded events and it produces
 * the same nodes every time (see traceEmitter.test.ts). No LLM, no IO.
 */
import type { StepLabels } from '@/libs/chat/stepLabels';

/** The subset of a raw LangChain v2 stream event we consume. */
import { fallbackStepLabels, stepLabelFor } from '@/libs/chat/stepLabels';

export type RawStreamEvent = {
  event?: string;
  name?: string;
  run_id?: string;
  metadata?: { checkpoint_ns?: unknown; langgraph_node?: unknown } & Record<string, unknown>;
  data?: {
    input?: { input?: unknown } & Record<string, unknown>;
    output?: unknown;
    chunk?: unknown;
    /** Set on `on_tool_error` — whatever the tool threw. */
    error?: unknown;
  } & Record<string, unknown>;
};

/** Tools that are runtime plumbing, not worth a user-facing trace node. */
const PLUMBING_TOOLS = new Set(['write_todos', 'ls', 'glob', 'grep', 'read_file', 'edit_file', 'write_file']);

function nsOf(ev: RawStreamEvent): string {
  const cp = ev.metadata?.checkpoint_ns;
  if (typeof cp === 'string') {
    return cp;
  }
  if (Array.isArray(cp)) {
    return cp.join('|');
  }
  return String(ev.metadata?.langgraph_node ?? '');
}

/**
 * taskId of the enclosing specialist, or undefined for the lead.
 * Exported so the tool-call record derives the same attribution.
 * @param ns
 */
export function taskIdOf(ns: string): string | undefined {
  if (!ns.includes('|')) {
    return undefined;
  }
  const first = ns.split('|')[0] ?? '';
  const m = first.match(/^tools:(.+)$/);
  return m ? m[1] : undefined;
}

/**
 * The `tools:<id>` node id for a top-level tool/delegation call.
 * @param ns
 */
export function toolNodeId(ns: string): string {
  return ns.match(/^tools:(.+)$/)?.[1] ?? ns;
}

/**
 * Extract `{ text, thinking }` from an AIMessageChunk's content (string or blocks).
 * @param chunk
 */
export function extractChunk(chunk: unknown): { text: string; thinking: string } {
  const c = (chunk as { content?: unknown } | null | undefined)?.content;
  if (typeof c === 'string') {
    return { text: c, thinking: '' };
  }
  let text = '';
  let thinking = '';
  if (Array.isArray(c)) {
    for (const block of c) {
      if (typeof block === 'string') {
        text += block;
      } else if (block && typeof block === 'object') {
        const b = block as { type?: string; text?: string; thinking?: string };
        if (b.type === 'text' && typeof b.text === 'string') {
          text += b.text;
        } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
          thinking += b.thinking;
        }
      }
    }
  }
  return { text, thinking };
}

export function parseJsonArgs(raw: unknown): Record<string, unknown> {
  const s = (raw as { input?: unknown })?.input ?? raw;
  if (typeof s !== 'string') {
    return (typeof s === 'object' && s !== null) ? (s as Record<string, unknown>) : {};
  }
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * The tool's string output from an on_tool_end ToolMessage.
 * @param output
 */
export function toolOutputContent(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  const o = output as { content?: unknown; update?: { messages?: unknown } } | null | undefined;
  if (o && typeof o.content === 'string') {
    return o.content;
  }
  return '';
}

/**
 * A tool's terminal status from an on_tool_end ToolMessage.
 *
 * LangGraph's ToolNode catches a throwing tool and returns a ToolMessage with
 * `status: 'error'` rather than letting the run fail, so a failed tool reaches
 * us as a perfectly ordinary `on_tool_end`. Reading the status is the only way
 * to tell "the specialist answered" from "the specialist blew up", and getting
 * that wrong is how a delegation that failed rendered as `<name> finished`.
 * @param output - `ev.data.output` from an `on_tool_end` event.
 */
export function toolResultStatus(output: unknown): 'success' | 'error' | undefined {
  const status = (output as { status?: unknown } | null | undefined)?.status;
  return status === 'error' || status === 'success' ? status : undefined;
}

/**
 * The human-readable message from an `on_tool_error` event (or from an errored
 * ToolMessage's content), capped so a stack trace never becomes a trace label.
 * @param raw - `ev.data.error`, or the ToolMessage content.
 */
export function toolErrorMessage(raw: unknown): string {
  const text = raw instanceof Error
    ? (raw.message || String(raw))
    : typeof raw === 'string'
      ? raw
      : (raw && typeof raw === 'object' && typeof (raw as { message?: unknown }).message === 'string')
          ? (raw as { message: string }).message
          : raw === undefined || raw === null
            ? ''
            : String(raw);
  const cleaned = text.replace(/^Error:\s*/i, '').replace(/\n\s*Please fix your mistakes\.?\s*$/i, '').trim();
  return (cleaned || 'the step failed with no message').slice(0, 300);
}

/**
 * Parse citations from a `search_knowledge` result. The tool formats hits as
 *   [1] **<title> — <date>** [<sourceType>] <blurb…>
 * one per hit. We pull title + sourceType + a short snippet per line.
 * @param content
 * @param actorId
 */
export function parseCitations(content: string, actorId: string): TraceCitation[] {
  const out: TraceCitation[] = [];
  const re = /\[(\d+)\]\s+\*\*(.+?)\*\*\s*(?:\[([\w-]+)\])?\s*([^\n[]*)/g;
  let m: RegExpExecArray | null = re.exec(content);
  while (m !== null) {
    const title = (m[2] ?? '').trim();
    if (title) {
      out.push({
        sourceType: (m[3] ?? 'source').trim(),
        title: title.length > 120 ? `${title.slice(0, 117)}…` : title,
        snippet: (m[4] ?? '').trim().slice(0, 160) || undefined,
        actorId,
      });
    }
    m = re.exec(content);
  }
  return out;
}

/**
 * Compact one-line view of tool args for the call-detail drill (never a dump).
 * @param args
 */
function argsPreview(args: Record<string, unknown>): string | undefined {
  const keys = Object.keys(args);
  if (keys.length === 0) {
    return undefined;
  }
  const compact: Record<string, unknown> = {};
  for (const k of keys) {
    const v = args[k];
    compact[k] = typeof v === 'string' && v.length > 80 ? `${v.slice(0, 77)}…` : v;
  }
  const s = JSON.stringify(compact);
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}

/**
 * lookup_objects returns a JSON array — pull the record names for the drill.
 * @param content
 */
function recordNames(content: string): string | undefined {
  try {
    const arr = JSON.parse(content) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) {
      return undefined;
    }
    const names = arr.map(r => String(r.contact ?? r.title ?? r.name ?? '').trim()).filter(Boolean);
    if (names.length === 0) {
      return undefined;
    }
    const shown = names.slice(0, 8).join(', ');
    return names.length > 8 ? `${shown} +${names.length - 8} more` : shown;
  } catch {
    return undefined;
  }
}

/**
 * Generic count summary for any JSON tool result — the "records found" line the
 * trace shows for every tool, not just the few with bespoke parsers. Reads the
 * result's own shape: top-level numbers ("total 16344"), array lengths
 * ("candidates 5"), and flat numeric maps ("meetingsBySource: zoom 318,
 * granola 5"). Payloads are authored count-first, so insertion order already
 * ranks what matters.
 * @param content
 */
export function summarizeCounts(content: string): { result?: string; resultDetail?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {};
  }
  if (Array.isArray(parsed)) {
    return { result: `${parsed.length} record${parsed.length === 1 ? '' : 's'}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number') {
      parts.push(`${k} ${Number.isInteger(v) ? v.toLocaleString('en-US') : v}`);
    } else if (Array.isArray(v)) {
      parts.push(`${k} ${v.length}`);
    } else if (v && typeof v === 'object') {
      const entries = Object.entries(v as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number');
      if (entries.length > 0 && entries.length === Object.keys(v).length) {
        parts.push(`${k}: ${entries.map(([ik, iv]) => `${ik} ${iv.toLocaleString('en-US')}`).join(', ')}`);
      }
    }
    if (parts.length >= 8) {
      break;
    }
  }
  if (parts.length === 0) {
    return {};
  }
  return {
    result: parts.slice(0, 3).join(' · '),
    resultDetail: parts.length > 3 ? parts.join(' · ') : undefined,
  };
}

/**
 * Classify a tool name into a trace-node kind.
 * @param tool
 */
function kindFor(tool: string): TraceNodeKind {
  if (tool === 'task') {
    return 'delegate';
  }
  if (tool === 'search_knowledge' || tool === 'web_search' || tool === 'search') {
    return 'search';
  }
  if (tool === 'recommend_action' || tool === 'propose_action') {
    return 'draft';
  }
  return 'tool';
}

/**
 * Tense-correct human label from (kind, status, subject).
 * @param kind
 * @param status
 * @param subject
 */
function labelFor(kind: TraceNodeKind, status: TraceNodeEvent['status'], subject: string): string {
  const running = status === 'start' || status === 'progress';
  if (status === 'error' && kind !== 'delegate') {
    return kind === 'search' ? `Search failed ${subject}`.trim() : `${subject} failed`.trim();
  }
  switch (kind) {
    case 'reason':
      return running ? 'Thinking' : 'Thought through it';
    case 'search':
      return running ? `Searching ${subject}`.trim() : `Searched ${subject}`.trim();
    case 'skill':
      return running ? `Running ${subject}`.trim() : `Ran ${subject}`.trim();
    case 'delegate':
      if (status === 'error') {
        return `${subject} could not finish`.trim();
      }
      return running ? `Delegating to ${subject}`.trim() : `${subject} finished`.trim();
    case 'draft':
      return running ? 'Preparing a recommendation' : 'Recommended an action';
    default:
      // "Used get_brand" named the mechanism; the deterministic table names
      // the act (`libs/chat/stepLabels.ts`). The model half may refine it
      // later through `applyLabels`.
      return stepLabelFor(fallbackStepLabels(subject), status);
  }
}

/**
 * A friendly one-liner describing a tool's input.
 * @param tool
 * @param args
 */
function detailFor(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === 'search_knowledge' || tool === 'web_search') {
    return typeof args.query === 'string' ? `"${args.query}"` : undefined;
  }
  if (tool === 'lookup_objects') {
    return typeof args.type_slug === 'string' ? `${args.type_slug} records` : undefined;
  }
  return undefined;
}

/**
 * Best display name for a delegated specialist. The subagent_type is often the
 * generic 'general-purpose', so first mine the brief for a stated role
 * ("You are a GTM ROI analyst …" → "GTM ROI Analyst"); fall back to a
 * humanized subagent_type, then a neutral label.
 * @param subagentType
 * @param description
 */
function specialistName(subagentType: string, description = ''): string {
  // A real named subagent (declared in workspace YAML) wins — show ITS name.
  if (subagentType && subagentType !== 'general-purpose') {
    return subagentType
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  // Generic subagent: mine a role from the brief ("You are a GTM ROI analyst").
  const m = description.match(/You are (?:an?|the)\s+([A-Z][\w /-]*?(?:analyst|lead|specialist|researcher|writer|manager|strategist|expert|engineer|agent|advisor|assistant))/i);
  if (m?.[1]) {
    return m[1]
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .map(w => (w.length > 3 || /[A-Z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
  return 'a specialist';
}

export type TraceEmitterOptions = {
  /** Display name of the front-door (lead) agent. */
  leadName: string;
};

/**
 * Stateful mapper. Call `handle(rawEvent)` for each v2 event; it returns zero
 * or more `TraceNodeEvent`s to forward to the SSE client. Also exposes the
 * accumulated citations so the caller can emit a final message-level set.
 */
/** The model is writing a tool call whose name is already known — the live line can say so. */
export type ComposingEvent = { type: 'composing'; tool: string };

export class TraceEmitter {
  private readonly leadName: string;
  /** taskId → specialist actor (recorded when the `task` tool starts). */
  private readonly specialists = new Map<string, TraceActor>();
  /** Every citation surfaced this turn, deduped by title+actor. */
  private readonly citationsSeen = new Set<string>();
  private readonly allCitations: TraceCitation[] = [];
  /** open reason nodes (id → actor/parent), so we emit `start` once then `progress`, and can close them when the answer begins. */
  private readonly openReason = new Map<string, { actor: TraceActor; parentId?: string }>();
  /** Tool calls already announced as being written, per model turn (`composing`). */
  private readonly composing = new Set<string>();
  /** Events beside the trace — `composing` — for the caller to drain after each `handle`. */
  private readonly sideEvents: ComposingEvent[] = [];
  /** node id → subject for the label (the query / skill name), so the `done` label matches `start`. */
  private readonly nodeSubjects = new Map<string, string>();
  /** node id → the pair a labeler supplied, so `done` uses the same words as `start`. */
  private readonly nodeLabels = new Map<string, StepLabels>();
  /** node id → the last status emitted, so a late label patch never rewinds a finished step. */
  private readonly nodeStatus = new Map<string, TraceNodeEvent['status']>();
  /** node id → (actor, parent, kind) for patches. */
  private readonly nodeMeta = new Map<string, { actor: TraceActor; parentId?: string; kind: TraceNodeKind }>();
  /**
   * Delegations that started and have not yet ended, so a run that dies
   * mid-delegation can still close them as failures. A delegate node left at
   * `start` forever is exactly the trace this class shipped with, and it is
   * indistinguishable from a delegation that is still running.
   */
  private readonly openDelegations = new Map<string, { actor: TraceActor; parentId?: string; name: string }>();

  constructor(opts: TraceEmitterOptions) {
    this.leadName = opts.leadName;
  }

  private leadActor(): TraceActor {
    return { id: 'lead', kind: 'lead', name: this.leadName };
  }

  private actorFor(ns: string): TraceActor {
    const taskId = taskIdOf(ns);
    if (!taskId) {
      return this.leadActor();
    }
    return this.specialists.get(taskId) ?? { id: taskId, kind: 'specialist', name: 'a specialist' };
  }

  /** All citations surfaced this turn (lead + every specialist). */
  citations(): TraceCitation[] {
    return this.allCitations;
  }

  /**
   * Whether a step is worth asking the labeler about: a plain tool or skill
   * call the lead or a specialist made. Searches keep their query, drafts
   * and delegations have names of their own.
   * @param id - The node id from a `start` event.
   */
  wantsLabels(id: string): boolean {
    const meta = this.nodeMeta.get(id);
    return Boolean(meta && (meta.kind === 'tool' || meta.kind === 'skill'));
  }

  /**
   * A labeler finished naming a step. Records the pair so the `done` event
   * uses the same words, and returns a patch event for the step at its
   * CURRENT status — a label that arrives after the step finished says
   * "Read the brand guide", never rewinds it to "Reading…".
   * @param id - The node id.
   * @param labels - The pair.
   */
  applyLabels(id: string, labels: StepLabels): TraceNodeEvent | null {
    const meta = this.nodeMeta.get(id);
    if (!meta) {
      return null;
    }
    this.nodeLabels.set(id, labels);
    const status = this.nodeStatus.get(id) ?? 'start';
    return {
      type: 'trace_node',
      id,
      parentId: meta.parentId,
      actor: meta.actor,
      kind: meta.kind,
      status,
      label: stepLabelFor(labels, status),
      labels,
    };
  }

  /**
   * Close any still-open reason nodes with a `done` status — call when the
   * answer starts streaming, so reasoning stops spinning "Thinking" while the
   * model does its post-answer tail (tool calls, drafts).
   */
  /** Events raised beside the trace by the last `handle` calls; emptied on read. */
  takeSideEvents(): ComposingEvent[] {
    return this.sideEvents.splice(0, this.sideEvents.length);
  }

  /**
   * A piece of the model's reasoning for the model turn at `ns` — extended
   * thinking from the stream, or a `<scratch>` block the answer streamer set
   * aside (`answerStream.ts`). Both are the same thing to the reader: what
   * the agent thought before it said something, folded to one line. One
   * reason node per actor per model turn; ns for a model turn is
   * "model_request:<id>" (lead) or "tools:<taskId>|model_request:<id>".
   * @param ns - The event's checkpoint namespace.
   * @param delta - The reasoning text to append.
   */
  reasonDelta(ns: string, delta: string): TraceNodeEvent[] {
    const actor = this.actorFor(ns);
    const modelSeg = ns.split('|').pop() ?? ns;
    const id = `reason:${modelSeg}`;
    const parentId = taskIdOf(ns);
    const first = !this.openReason.has(id);
    if (first) {
      this.openReason.set(id, { actor, parentId });
    }
    return [{
      type: 'trace_node',
      id,
      parentId,
      actor,
      kind: 'reason',
      status: first ? 'start' : 'progress',
      label: labelFor('reason', 'progress', ''),
      delta,
    }];
  }

  closeReasoning(): TraceNodeEvent[] {
    const out: TraceNodeEvent[] = [];
    for (const [id, { actor, parentId }] of this.openReason) {
      out.push({
        type: 'trace_node',
        id,
        parentId,
        actor,
        kind: 'reason',
        status: 'done',
        label: labelFor('reason', 'done', ''),
      });
    }
    this.openReason.clear();
    return out;
  }

  /**
   * Display name of the specialist a `task` node dispatched, if it is known.
   * @param nodeId
   */
  delegateName(nodeId: string): string | undefined {
    return this.specialists.get(nodeId)?.name;
  }

  /** Delegations that started and never reported an outcome. */
  openDelegationNames(): string[] {
    return [...this.openDelegations.values()].map(d => d.name);
  }

  /**
   * Close every still-open delegation as a FAILURE. Called when the run itself
   * throws: the specialist did not finish, and a trace that stops at `start`
   * says nothing about why.
   * @param message - What went wrong, already human-readable.
   */
  closeDelegations(message: string): TraceNodeEvent[] {
    const out: TraceNodeEvent[] = [];
    for (const [id, { actor, parentId, name }] of this.openDelegations) {
      out.push({
        type: 'trace_node',
        id,
        parentId,
        actor,
        kind: 'delegate',
        status: 'error',
        label: labelFor('delegate', 'error', name),
        result: message.slice(0, 160),
      });
    }
    this.openDelegations.clear();
    return out;
  }

  private recordCitations(cites: TraceCitation[]): TraceCitation[] {
    const fresh: TraceCitation[] = [];
    for (const c of cites) {
      const key = `${c.actorId}::${c.title}`;
      if (!this.citationsSeen.has(key)) {
        this.citationsSeen.add(key);
        this.allCitations.push(c);
        fresh.push(c);
      }
    }
    return fresh;
  }

  handle(ev: RawStreamEvent): TraceNodeEvent[] {
    const ns = nsOf(ev);
    switch (ev.event) {
      case 'on_chat_model_stream': {
        // A tool call streams in pieces and its name arrives first: say what
        // is being written while the arguments (a whole HTML document, on
        // 2026-09-18, for 40 seconds) are still coming — 'Working' says nothing.
        const chunks = (ev.data?.chunk as { tool_call_chunks?: Array<{ name?: string | null }> } | undefined)?.tool_call_chunks ?? [];
        const named = chunks.find(c => typeof c.name === 'string' && c.name.length > 0)?.name;
        if (named && !PLUMBING_TOOLS.has(named) && !this.composing.has(`${ns}:${named}`)) {
          this.composing.add(`${ns}:${named}`);
          this.sideEvents.push({ type: 'composing', tool: named });
        }
        const { thinking } = extractChunk(ev.data?.chunk);
        if (!thinking) {
          return [];
        }
        return this.reasonDelta(ns, thinking);
      }

      case 'on_tool_start': {
        const tool = ev.name ?? 'tool';
        if (PLUMBING_TOOLS.has(tool)) {
          return [];
        }
        const args = parseJsonArgs(ev.data?.input);
        const kind = kindFor(tool);
        const id = toolNodeId(ns);
        const actor = this.actorFor(ns);
        const parentId = taskIdOf(ns);

        if (kind === 'delegate') {
          // Record the specialist so its nested events attribute correctly.
          const subagentType = typeof args.subagent_type === 'string' ? args.subagent_type : '';
          const description = typeof args.description === 'string' ? args.description : '';
          const name = specialistName(subagentType, description);
          this.specialists.set(id, { id, kind: 'specialist', name });
          this.openDelegations.set(id, { actor, parentId, name });
          const brief = description ? description.replace(/\s+/g, ' ').trim().slice(0, 140) : undefined;
          return [{
            type: 'trace_node',
            id,
            parentId,
            actor,
            kind,
            status: 'start',
            label: labelFor('delegate', 'start', name),
            detail: brief,
          }];
        }

        const detail = detailFor(tool, args);
        const subject = kind === 'search'
          ? (detail ?? tool)
          : kind === 'skill'
            ? (detail ?? 'a skill')
            : tool;
        this.nodeSubjects.set(id, subject);
        this.nodeMeta.set(id, { actor, parentId, kind });
        this.nodeStatus.set(id, 'start');
        return [{
          type: 'trace_node',
          id,
          parentId,
          actor,
          kind,
          status: 'start',
          label: labelFor(kind, 'start', subject),
          detail,
          tool,
          args: argsPreview(args),
        }];
      }

      case 'on_tool_end': {
        const tool = ev.name ?? 'tool';
        if (PLUMBING_TOOLS.has(tool)) {
          return [];
        }
        const kind = kindFor(tool);
        const id = toolNodeId(ns);
        const actor = this.actorFor(ns);
        const parentId = taskIdOf(ns);
        const content = toolOutputContent(ev.data?.output);

        const failed = toolResultStatus(ev.data?.output) === 'error';

        if (kind === 'delegate') {
          const name = this.specialists.get(id)?.name ?? 'a specialist';
          this.openDelegations.delete(id);
          const status = failed ? 'error' as const : 'done' as const;
          return [{
            type: 'trace_node',
            id,
            parentId,
            actor,
            kind,
            status,
            label: labelFor('delegate', status, name),
            ...(failed ? { result: toolErrorMessage(content).slice(0, 160) } : {}),
          }];
        }

        if (failed) {
          // A tool the graph caught and turned into an error ToolMessage. It
          // is still an `on_tool_end`; rendering it as "Used X" would say the
          // opposite of what happened.
          const subject = this.nodeSubjects.get(id) ?? tool;
          this.nodeStatus.set(id, 'error');
          return [{
            type: 'trace_node',
            id,
            parentId,
            actor,
            kind,
            status: 'error',
            label: labelFor(kind, 'error', subject),
            result: toolErrorMessage(content).slice(0, 160),
          }];
        }

        let citations: TraceCitation[] | undefined;
        let result: string | undefined;
        let resultDetail: string | undefined;
        if (kind === 'search') {
          const parsed = parseCitations(content, actor.id);
          citations = this.recordCitations(parsed);
          result = parsed.length ? `${parsed.length} source${parsed.length === 1 ? '' : 's'}` : 'no matches';
        } else if (tool === 'lookup_objects') {
          const count = (content.match(/"title"|"contact"/g) ?? []).length;
          result = count ? `${count} record${count === 1 ? '' : 's'}` : undefined;
          resultDetail = recordNames(content);
        } else {
          // Every other tool: surface the result's own counts, so "how many
          // records did this find" is answered in the trace, not hidden.
          ({ result, resultDetail } = summarizeCounts(content));
        }

        const subject = this.nodeSubjects.get(id) ?? tool;
        this.nodeStatus.set(id, 'done');
        const pair = this.nodeLabels.get(id);
        return [{
          type: 'trace_node',
          id,
          parentId,
          actor,
          kind,
          status: 'done',
          label: pair ? stepLabelFor(pair, 'done') : labelFor(kind, 'done', subject),
          ...(pair ? { labels: pair } : {}),
          result,
          resultDetail,
          citations: citations && citations.length ? citations : undefined,
        }];
      }

      case 'on_tool_error': {
        // The other half of a failed tool: when nothing catches it, LangChain
        // ends the run with `on_tool_error` and NO `on_tool_end`. Without this
        // case the node stayed at `start` forever — which is the whole reason a
        // failed delegation reached the person as one "Delegating…" line and
        // nothing else.
        const tool = ev.name ?? 'tool';
        if (PLUMBING_TOOLS.has(tool)) {
          return [];
        }
        const kind = kindFor(tool);
        const id = toolNodeId(ns);
        const actor = this.actorFor(ns);
        const parentId = taskIdOf(ns);
        const message = toolErrorMessage(ev.data?.error);
        const subject = kind === 'delegate'
          ? (this.specialists.get(id)?.name ?? 'a specialist')
          : (this.nodeSubjects.get(id) ?? tool);
        if (kind === 'delegate') {
          this.openDelegations.delete(id);
        }
        this.nodeStatus.set(id, 'error');
        return [{
          type: 'trace_node',
          id,
          parentId,
          actor,
          kind,
          status: 'error',
          label: labelFor(kind, 'error', subject),
          detail: kind === 'delegate' ? undefined : this.nodeSubjects.get(id),
          tool,
          result: message.slice(0, 160),
          resultDetail: message,
        }];
      }

      default:
        return [];
    }
  }
}
