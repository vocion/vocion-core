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
import type { TraceActor, TraceCitation, TraceNodeEvent, TraceNodeKind } from './types';

/** The subset of a raw LangChain v2 stream event we consume. */
export type RawStreamEvent = {
  event?: string;
  name?: string;
  run_id?: string;
  metadata?: { checkpoint_ns?: unknown; langgraph_node?: unknown } & Record<string, unknown>;
  data?: {
    input?: { input?: unknown } & Record<string, unknown>;
    output?: unknown;
    chunk?: unknown;
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

/** taskId of the enclosing specialist, or undefined for the lead. */
function taskIdOf(ns: string): string | undefined {
  if (!ns.includes('|')) {
    return undefined;
  }
  const first = ns.split('|')[0] ?? '';
  const m = first.match(/^tools:(.+)$/);
  return m ? m[1] : undefined;
}

/** The `tools:<id>` node id for a top-level tool/delegation call. */
function toolNodeId(ns: string): string {
  return ns.match(/^tools:(.+)$/)?.[1] ?? ns;
}

/** Extract `{ text, thinking }` from an AIMessageChunk's content (string or blocks). */
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

/** The tool's string output from an on_tool_end ToolMessage. */
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
 * Parse citations from a `search_knowledge` result. The tool formats hits as
 *   [1] **<title> — <date>** [<sourceType>] <blurb…>
 * one per hit. We pull title + sourceType + a short snippet per line.
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

/** Classify a tool name into a trace-node kind. */
function kindFor(tool: string): TraceNodeKind {
  if (tool === 'task') {
    return 'delegate';
  }
  if (tool === 'run_operation') {
    return 'skill';
  }
  if (tool === 'search_knowledge' || tool === 'web_search' || tool === 'search') {
    return 'search';
  }
  if (tool === 'recommend_action' || tool === 'propose_action') {
    return 'draft';
  }
  return 'tool';
}

/** Tense-correct human label from (kind, status, subject). */
function labelFor(kind: TraceNodeKind, status: TraceNodeEvent['status'], subject: string): string {
  const running = status === 'start' || status === 'progress';
  switch (kind) {
    case 'reason':
      return running ? 'Thinking' : 'Thought through it';
    case 'search':
      return running ? `Searching ${subject}`.trim() : `Searched ${subject}`.trim();
    case 'skill':
      return running ? `Running ${subject}`.trim() : `Ran ${subject}`.trim();
    case 'delegate':
      return running ? `Delegating to ${subject}`.trim() : `${subject} finished`.trim();
    case 'draft':
      return running ? 'Preparing a recommendation' : 'Recommended an action';
    default:
      return running ? `Using ${subject}`.trim() : `Used ${subject}`.trim();
  }
}

/** A friendly one-liner describing a tool's input. */
function detailFor(tool: string, args: Record<string, unknown>): string | undefined {
  if (tool === 'search_knowledge' || tool === 'web_search') {
    return typeof args.query === 'string' ? `"${args.query}"` : undefined;
  }
  if (tool === 'lookup_objects') {
    return typeof args.type_slug === 'string' ? `${args.type_slug} records` : undefined;
  }
  if (tool === 'run_operation') {
    return typeof args.operation === 'string' ? String(args.operation) : (typeof args.slug === 'string' ? String(args.slug) : undefined);
  }
  return undefined;
}

/**
 * Best display name for a delegated specialist. The subagent_type is often the
 * generic 'general-purpose', so first mine the brief for a stated role
 * ("You are a GTM ROI analyst …" → "GTM ROI Analyst"); fall back to a
 * humanized subagent_type, then a neutral label.
 */
function specialistName(subagentType: string, description = ''): string {
  const m = description.match(/[Yy]ou are (?:an?|the)\s+([A-Za-z][\w /-]*?(?:analyst|lead|specialist|researcher|writer|manager|strategist|expert|engineer|agent|advisor|assistant))/i);
  if (m?.[1]) {
    return m[1]
      .trim()
      .replace(/\s+/g, ' ')
      .split(' ')
      .map(w => (w.length > 3 || /[A-Z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(' ');
  }
  if (subagentType && subagentType !== 'general-purpose') {
    return subagentType
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
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
export class TraceEmitter {
  private readonly leadName: string;
  /** taskId → specialist actor (recorded when the `task` tool starts). */
  private readonly specialists = new Map<string, TraceActor>();
  /** Every citation surfaced this turn, deduped by title+actor. */
  private readonly citationsSeen = new Set<string>();
  private readonly allCitations: TraceCitation[] = [];
  /** reason node ids already opened, so we emit `start` once then `progress`. */
  private readonly openReason = new Set<string>();
  /** node id → subject for the label (the query / skill name), so the `done` label matches `start`. */
  private readonly nodeSubjects = new Map<string, string>();

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
        const { thinking } = extractChunk(ev.data?.chunk);
        if (!thinking) {
          return [];
        }
        // One reason node per actor per model turn. ns for a model turn is
        // "model_request:<id>" (lead) or "tools:<taskId>|model_request:<id>".
        const actor = this.actorFor(ns);
        const modelSeg = ns.split('|').pop() ?? ns;
        const id = `reason:${modelSeg}`;
        const parentId = taskIdOf(ns);
        const first = !this.openReason.has(id);
        if (first) {
          this.openReason.add(id);
        }
        return [{
          type: 'trace_node',
          id,
          parentId,
          actor,
          kind: 'reason',
          status: first ? 'start' : 'progress',
          label: labelFor('reason', 'progress', ''),
          delta: thinking,
        }];
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
        return [{
          type: 'trace_node',
          id,
          parentId,
          actor,
          kind,
          status: 'start',
          label: labelFor(kind, 'start', subject),
          detail,
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

        if (kind === 'delegate') {
          const name = this.specialists.get(id)?.name ?? 'a specialist';
          return [{
            type: 'trace_node',
            id,
            parentId,
            actor,
            kind,
            status: 'done',
            label: labelFor('delegate', 'done', name),
          }];
        }

        let citations: TraceCitation[] | undefined;
        let result: string | undefined;
        if (kind === 'search') {
          const parsed = parseCitations(content, actor.id);
          citations = this.recordCitations(parsed);
          result = parsed.length ? `${parsed.length} source${parsed.length === 1 ? '' : 's'}` : 'no matches';
        } else if (tool === 'lookup_objects') {
          const count = (content.match(/"title"/g) ?? []).length;
          result = count ? `${count} record${count === 1 ? '' : 's'}` : undefined;
        }

        const subject = this.nodeSubjects.get(id) ?? tool;
        return [{
          type: 'trace_node',
          id,
          parentId,
          actor,
          kind,
          status: 'done',
          label: labelFor(kind, 'done', subject),
          result,
          citations: citations && citations.length ? citations : undefined,
        }];
      }

      default:
        return [];
    }
  }
}
