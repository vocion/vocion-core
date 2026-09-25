'use client';

import type { LucideIcon } from 'lucide-react';
import type { AgentRun, IndexedDocument, TraceNode } from './types';
import type { FailureReport } from '@/libs/chat/redact';
import {
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  ExternalLink,

  GitBranch,
  Loader2,
  PencilLine,
  Rows3,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { failureReport, redactInternalIds } from '@/libs/chat/redact';
import { stepHeadline } from '@/libs/chat/stepHeadline';
import { sourceLabels } from './helpers';
import { liveStepLabel } from './traceReducer';
import { useElapsed } from './useElapsed';

/**
 * WorkTimeline — the agent Activity trace.
 *
 * LIVE (agent-chat-surface.md §9): the rows appear as the agent works — a
 * tool row the moment its start event arrives, flipping to done/error when it
 * lands; delegates indent their specialist's rows; reasoning folds to one
 * line ("Thinking…" → "Thought for 6s") with its first sentence showing.
 * AFTER the turn: one collapsed line that says what the work WAS —
 * "Researched 30 sources and wrote the brief" (`libs/chat/stepHeadline.ts`) —
 * and opens into the curated, typed trace — reasoning, meaningful tool steps
 * (plumbing hidden), delegation to named specialists, citations.
 *
 * No card. A group of steps is a quieter line between the passages, not a
 * box in the prose: muted grey once finished so it sits behind the words,
 * a soft text shimmer while it runs (Chris, 2026-09-18, against the Claude
 * app). Hairlines, not borders (docs/design/patterns.md).
 */

export type WorkTimelineProps = {
  runs: Extract<AgentRun, { type: 'tool' }>[];
  streaming: boolean;
  activity?: string | null;
  thinkingText?: string;
  /** Sources the answer drew on — rendered as citations inside the trace. */
  documents?: IndexedDocument[];
  /**
   * Typed hierarchical trace (reason/tool/skill/search/delegate/draft with
   * per-actor nesting + citations). When present it drives the trace instead
   * of the flat `runs`/`thinkingText` fallback.
   */
  trace?: TraceNode[];
  /**
   * A counter the "Tool error" badge bumps. Each bump opens the trace and
   * expands the failed step(s) — the badge is the way IN to the failure, not
   * a decoration over it (CEO, 2026-09-16: *"how do I get details on this
   * tool error, to share with you?"*).
   */
  inspect?: number;
  /** Who this turn was, so a failed step can be copied as a report. */
  failureContext?: FailureReport;
  /**
   * Whether a streaming group shows its own "Working…" bar above the rows.
   * The transcript turns this off: the live indicator at the bottom of the
   * turn already names the activity, and the group's job is its rows.
   */
  liveHeadline?: boolean;
};

// Plumbing the operator shouldn't have to see — hidden from the curated trace.
const PLUMBING = new Set(['write_todos', 'ls', 'glob', 'grep', 'read_file', 'edit_file', 'write_file']);

type Kind = 'delegation' | 'records' | 'search' | 'draft' | 'proposal' | 'skill' | 'generic';

function kindFor(name: string): { kind: Kind; icon: LucideIcon } {
  switch (name) {
    case 'task': return { kind: 'delegation', icon: GitBranch };
    case 'lookup_objects': return { kind: 'records', icon: Rows3 };
    case 'search_knowledge':
    case 'web_search': return { kind: 'search', icon: Search };
    case 'create_artifact': return { kind: 'draft', icon: PencilLine };
    case 'propose_action':
    case 'request_human_review': return { kind: 'proposal', icon: ShieldCheck };
    default:
      return /draft/i.test(name)
        ? { kind: 'draft', icon: PencilLine }
        : { kind: 'generic', icon: Sparkles };
  }
}

/**
 * One human-legible description per tool call — shared by the trace nodes AND
 * the live activity line, so "what it's doing" and "what it did" agree.
 * @param name
 * @param input
 * @param live - present-tense phrasing for the live activity line
 */
export function describeToolCall(name: string, input: Record<string, unknown>, live = false): { label: string; detail?: string } {
  switch (name) {
    case 'task': {
      const desc = String(input.description ?? '');
      const m = desc.match(/[Yy]ou are (?:the )?([A-Z][a-z-]+(?: [A-Z][a-z-]+){0,3})/);
      let who = (m?.[1] ?? String(input.subagent_type ?? '')).trim();
      if (!who || who.includes('-') || /^(?:general.?purpose|specialist)$/i.test(who)) {
        who = 'a specialist';
      }
      const summary = desc.replace(/^.*?[Yy]ou are[^.]*\.\s*/, '').replace(/\s+/g, ' ').trim();
      const detail = summary ? `“${summary.slice(0, 100)}${summary.length > 100 ? '…' : ''}”` : undefined;
      return { label: live ? `Handing off to ${who}…` : `Delegated to ${who}`, detail };
    }
    case 'search_knowledge': {
      const q = String(input.query ?? '');
      return { label: live ? 'Searching sources…' : 'Searched sources', detail: q ? `“${q.slice(0, 90)}”` : undefined };
    }
    case 'lookup_objects':
      return { label: live ? 'Looking up records…' : 'Looked up records', detail: String(input.type ?? input.object_type ?? '') || undefined };
    case 'propose_action': {
      const actionId = String(input.action_id ?? 'action');
      const conf = typeof input.confidence === 'number' ? ` · ${Math.round((input.confidence as number) * 100)}%` : '';
      // Whether it ran or waits is the run's to say (the card below carries
      // its status); this line stops claiming it was queued.
      return { label: live ? `Recommending ${actionId}${conf}…` : `Recommended ${actionId}${conf}` };
    }
    case 'create_artifact':
      return { label: live ? 'Creating artifact…' : 'Created artifact', detail: String(input.kind ?? '') || undefined };
    case 'request_human_review':
      return { label: live ? 'Requesting approval…' : 'Requested approval' };
    case 'web_search':
      return { label: live ? 'Searching the web…' : 'Searched the web', detail: String(input.query ?? '').slice(0, 90) || undefined };
    default:
      return { label: `${live ? 'Running' : 'Ran'} ${name.replace(/[-_]/g, ' ')}${live ? '…' : ''}` };
  }
}

function outputSnippet(output: unknown): string | undefined {
  const s = String(output ?? '').replaceAll(/\s+/g, ' ').trim();
  if (!s || s.length < 3) {
    return undefined;
  }
  if (/^[[{]/.test(s) || (s.includes('":') && s.includes('{'))) {
    return undefined;
  }
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

/**
 * lookup_objects returns a JSON record array. Surface a count + the names here
 * (the "data reviewed"), never dumped in the reply.
 * @param raw
 */
function summarizeRecords(raw: unknown): { detail: string; names: string } | null {
  try {
    const arr = JSON.parse(String(raw ?? '')) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr) || arr.length === 0) {
      return null;
    }
    const names = arr.map(r => String(r.contact ?? r.title ?? '').trim()).filter(Boolean);
    const shown = names.slice(0, 6).join(', ');
    return { detail: `${arr.length} record${arr.length === 1 ? '' : 's'}`, names: `${shown}${names.length > 6 ? ` +${names.length - 6} more` : ''}` };
  } catch {
    return null;
  }
}

type Node = { icon: LucideIcon; kind: Kind; label: string; detail?: string; drillLabel?: string; drill?: string; state: 'pending' | 'done' | 'error' };

function toNode(run: Extract<AgentRun, { type: 'tool' }>): Node {
  const input = run.input ?? {};
  const state = run.state ?? 'done';
  if (run.name === 'error') {
    return { icon: CircleAlert, kind: 'generic', label: 'Error', detail: redactInternalIds(String(run.output ?? '')).slice(0, 160), state: 'error' };
  }
  const { icon, kind } = kindFor(run.name);
  const { label, detail } = describeToolCall(run.name, input);
  if (run.name === 'lookup_objects' && state === 'done') {
    const s = summarizeRecords(run.output);
    if (s) {
      return { icon, kind, label, detail: s.detail, drillLabel: `the ${s.detail}`, drill: s.names, state };
    }
  }
  const out = state === 'done' ? outputSnippet(run.output) : undefined;
  return { icon, kind, label, detail, drill: out, state };
}

function Marker({ node }: { node: Node }) {
  const cls = node.state === 'error' ? 'text-[var(--brand-fail)]' : node.state === 'pending' ? 'text-brand-amber-deep' : 'text-[var(--brand-pass)]';
  if (node.state === 'pending') {
    return <Loader2 className={`size-3.5 shrink-0 animate-spin ${cls}`} aria-hidden />;
  }
  const Icon = node.icon;
  return <Icon className={`size-3.5 shrink-0 ${node.kind === 'delegation' ? 'text-brand-amber-deep' : cls}`} aria-hidden />;
}

function Citation({ doc }: { doc: IndexedDocument }) {
  const label = sourceLabels[doc.source_type] ?? doc.source_type;
  return (
    // A hairline row inside the trace's own surface, not a card in a card
    // (docs/design/patterns.md → Never).
    <a href={doc.link} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 border-t border-rule px-3 py-2 transition first:border-t-0 hover:bg-muted/40">
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{doc.semantic_identifier}</span>
        {doc.blurb && <span className="block truncate text-[11px] text-muted-foreground">{doc.blurb}</span>}
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Typed-trace rendering (preferred path)                              */
/* ------------------------------------------------------------------ */

const TRACE_ICON: Record<TraceNode['kind'], LucideIcon> = {
  reason: Brain,
  tool: Wrench,
  skill: Wrench,
  search: Search,
  delegate: GitBranch,
  draft: PencilLine,
};

function TraceMarker({ node }: { node: TraceNode }) {
  if (node.status !== 'done' && node.status !== 'error') {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />;
  }
  if (node.status === 'error') {
    return <CircleAlert className="size-3.5 shrink-0 text-[var(--brand-fail)]" aria-hidden />;
  }
  const Icon = TRACE_ICON[node.kind] ?? Sparkles;
  return <Icon className={`size-3.5 shrink-0 ${node.kind === 'delegate' ? 'text-brand-amber-deep' : 'text-[var(--brand-pass)]'}`} aria-hidden />;
}

function TraceCitations({ node }: { node: TraceNode }) {
  const cites = node.citations ?? [];
  if (cites.length === 0) {
    return null;
  }
  return (
    <div className="mt-1.5 grid gap-1">
      {cites.slice(0, 5).map((c, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide uppercase">{sourceLabels[c.sourceType] ?? c.sourceType}</span>
          <span className="min-w-0 flex-1 truncate">{c.title}</span>
        </div>
      ))}
      {cites.length > 5 && (
        <span className="text-[10px] text-muted-foreground/60">
          +
          {cites.length - 5}
          {' '}
          more
        </span>
      )}
    </div>
  );
}

/**
 * What a failed step says, and how to hand it to someone else.
 *
 * On screen the message is REDACTED (`libs/chat/redact.ts`): a tenant id or a
 * `__sentinel__` slug in a sentence a person reads is a leak dressed as an
 * explanation. *Copy details* puts the raw block on the clipboard — turn,
 * conversation, when, tool, delegate, error — which is the whole reason the
 * redaction is safe to do.
 * @param root0 - Component props.
 * @param root0.node - The failed trace node.
 * @param root0.context - Who this turn was.
 */
function FailureDetail({ node, context }: { node: TraceNode; context?: FailureReport }) {
  const [copied, setCopied] = useState(false);
  const raw = node.resultDetail ?? node.result ?? node.detail ?? node.label;
  const shown = redactInternalIds(raw ?? '');
  const block = failureReport({
    ...context,
    tool: node.tool ?? node.label,
    message: raw ?? null,
    delegate: node.actor.kind === 'specialist' ? node.actor.name : (context?.delegate ?? null),
  });
  return (
    <div data-testid="failed-step" className="mt-1.5">
      <p className="rounded-lg bg-[var(--brand-fail-bg)]/50 p-2.5 text-[12px] leading-relaxed break-words text-[var(--brand-fail)]">{shown}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {node.tool && (
          <span>
            tool ·
            {' '}
            <span className="font-mono">{node.tool}</span>
          </span>
        )}
        {node.actor.kind === 'specialist' && (
          <span>
            in ·
            {' '}
            {node.actor.name}
          </span>
        )}
        <button
          type="button"
          data-testid="copy-failure"
          onClick={() => {
            void navigator.clipboard?.writeText(block).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand-amber-deep transition hover:bg-muted"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <ClipboardCopy className="size-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
    </div>
  );
}

/**
 * The tool/input/result call detail for a tool·search·skill node's drill.
 * @param root0
 * @param root0.node
 */
function CallDetail({ node }: { node: TraceNode }) {
  const rows: Array<[string, string]> = [];
  if (node.tool) {
    rows.push(['tool', node.tool]);
  }
  if (node.args) {
    rows.push(['input', node.args]);
  }
  const resultLine = node.resultDetail ?? node.result;
  if (resultLine) {
    rows.push(['result', resultLine]);
  }
  if (rows.length === 0) {
    return null;
  }
  return (
    <span className="mt-1 block max-h-60 overflow-y-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
      {rows.map(([k, v]) => (
        <span key={k} className="block">
          <span className="text-muted-foreground/60">{k.padEnd(7)}</span>
          {v}
        </span>
      ))}
    </span>
  );
}

/**
 * A single trace node row — live, finished, root or nested. It is the SAME
 * one-line row as a finished step ({@link ClaimLine}): the label, what it was
 * on, and its result on one line, the call behind a tap on the row. It used to
 * be a second, two-line shape with "Show call" on a line of its own, so a step
 * changed shape the moment the turn finished (Chris, 2026-09-25: "Tool call as
 * one line looks better. I don't need two lines to show a link").
 * @param root0 - Component props.
 * @param root0.node - The trace node.
 * @param root0.nested - Indented under a delegate.
 * @param root0.open - Whether the call detail is showing.
 * @param root0.onToggle - Show or hide the call detail.
 * @param root0.failureContext - Stamped into a failed step's Copy details.
 */
function TraceRow({ node, nested, open, onToggle, failureContext }: { node: TraceNode; nested?: boolean; open: boolean; onToggle: () => void; failureContext?: FailureReport }) {
  const isReason = node.kind === 'reason';
  const drillText = isReason ? node.text?.trim() : undefined;
  // A tool·search·skill node drills into its call detail (tool / input / result).
  const hasCallDetail = !isReason && node.kind !== 'delegate' && Boolean(node.tool || node.args || node.resultDetail);
  const hasCitations = (node.citations?.length ?? 0) > 0;
  const suffix = [
    typeof node.confidence === 'number' ? `${Math.round(node.confidence * 100)}%` : null,
    node.actor.kind === 'specialist' && !nested ? node.actor.name : null,
  ].filter(Boolean).join(' · ');
  const label = node.kind === 'delegate' ? `→ ${liveStepLabel(node)}` : liveStepLabel(node);
  return (
    <ClaimLine
      id={node.id}
      nested={nested}
      icon={<TraceMarker node={node} />}
      label={label}
      detail={[node.detail, suffix].filter(Boolean).join(' · ') || undefined}
      radius={node.result ?? (node.resultDetail && node.resultDetail.length <= 60 ? node.resultDetail : undefined)}
      error={node.status === 'error'}
      open={open}
      onToggle={drillText || hasCallDetail ? onToggle : undefined}
      // A failure is never folded away: the message (redacted) and the way to
      // hand it to someone else sit right on the step. Citations under a
      // search stay visible too — they are what the step found.
      after={node.status === 'error' || hasCitations
        ? (
            <>
              {node.status === 'error' && <FailureDetail node={node} context={failureContext} />}
              {hasCitations && <TraceCitations node={node} />}
            </>
          )
        : undefined}
    >
      {drillText
        ? <span className="block max-h-72 overflow-y-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{drillText}</span>
        : hasCallDetail ? <CallDetail node={node} /> : null}
    </ClaimLine>
  );
}

export function WorkTimeline({ runs, streaming, activity, thinkingText, documents = [], trace, inspect = 0, failureContext, liveHeadline = true }: WorkTimelineProps) {
  if (trace && trace.length > 0) {
    return <TraceTimeline trace={trace} streaming={streaming} activity={activity} documents={documents} inspect={inspect} failureContext={failureContext} liveHeadline={liveHeadline} />;
  }
  return <LegacyWorkTimeline runs={runs} streaming={streaming} activity={activity} thinkingText={thinkingText} documents={documents} inspect={inspect} />;
}

function TraceTimeline({ trace, streaming, activity, documents = [], inspect = 0, failureContext, liveHeadline = true }: { trace: TraceNode[]; streaming: boolean; activity?: string | null; documents?: IndexedDocument[]; inspect?: number; failureContext?: FailureReport; liveHeadline?: boolean }) {
  // Level-1 lines expand independently; one control recollapses everything
  // (agent-chat-surface.md §2.1 rule 1).
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [openDrill, setOpenDrill] = useState<string | null>(null);
  // After the turn the whole trace folds to one line — "Worked it out · N
  // steps" — and opens on tap (§2). Live, it is always open.
  const [expanded, setExpanded] = useState(false);
  const elapsed = useElapsed(streaming);
  // How long the agent thought before its first action — frozen the moment
  // an action starts, so the label reads "Thought for 6s" afterwards.
  const [thinkingSeconds, setThinkingSeconds] = useState(0);

  const roots = trace.filter(n => !n.parentId);
  const actions = roots.filter(n => n.kind !== 'reason');
  const reasons = roots.filter(n => n.kind === 'reason');
  const childrenOf = (id: string) => trace.filter(n => n.parentId === id);
  const steps = trace.filter(n => n.kind !== 'reason').length;
  const sources = documents.length;
  const anyOpen = openIds.size > 0;
  const stillThinking = streaming && reasons.length > 0 && actions.length === 0;
  useEffect(() => {
    if (stillThinking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
      setThinkingSeconds(elapsed);
    }
  }, [stillThinking, elapsed]);
  // The badge asked to see the failure: open the trace and every failed step,
  // including a failure that happened inside a delegate.
  const failedIds = trace.filter(n => n.status === 'error').map(n => n.id);
  const failedKey = failedIds.join('|');
  useEffect(() => {
    if (inspect <= 0) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setExpanded(true);
    const ids = failedKey ? failedKey.split('|') : [];
    const withParents = ids.flatMap(id => [id, trace.find(n => n.id === id)?.parentId ?? id]);
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setOpenIds(new Set(withParents));
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
    setOpenDrill(ids[0] ?? null);
  }, [inspect, failedKey]);

  const thoughtLabel = thinkingSeconds >= 2 ? `Thought for ${thinkingSeconds}s` : 'Thought it through';

  // A completed turn with no real actions and no sources has nothing worth
  // surfacing; keep the line while streaming (live status).
  if (!streaming && steps === 0 && sources === 0) {
    return null;
  }

  const toggle = (id: string) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
  const collapseAll = () => {
    setOpenIds(new Set());
    setOpenDrill(null);
  };

  // LIVE, the group is FOLDED like a finished one: one line naming the work
  // so far, the rows behind a tap. What is happening right now is said once,
  // by the shimmering status line at the bottom of the turn (Chris,
  // 2026-09-25: "We can probably stay collapsed by default while thinking.
  // As long as the text is updating to show what is happening"). A surface
  // with no status line of its own (`liveHeadline`) gets it here instead.
  if (streaming) {
    const live = [...trace].reverse().find(n => n.kind !== 'reason' && (n.status === 'start' || n.status === 'progress'));
    // "Working…" on its own for a minute told the person nothing (Chris,
    // twice). The step that is running says what it is on, and — when the
    // call reports — where it has got to: `Building the document… sheet 7 of 12`.
    const headline = activity ?? (live ? liveStepLabel(live) : null) ?? (actions.length === 0 && reasons.length > 0 ? 'Thinking…' : 'Working…');
    // A failure is never folded away: a group with a failed step opens itself.
    const liveOpen = expanded || actions.some(n => n.status === 'error');
    if (liveHeadline) {
      return (
        <div className="my-2" data-testid="work-timeline-live">
          <LiveStatus text={headline} elapsed={elapsed} />
          {actions.length > 0 && <StepGroupLine actions={actions} sources={sources} expanded={liveOpen} onToggle={() => setExpanded(v => !v)} />}
          {liveOpen && <StepList reasons={reasons} actions={actions} childrenOf={childrenOf} thoughtLabel={thoughtLabel} openIds={openIds} toggle={toggle} failureContext={failureContext} testId="work-steps-live" />}
        </div>
      );
    }
    // Only thinking so far: the status line says so; there is no step to fold.
    if (actions.length === 0) {
      return null;
    }
    return (
      <div className="my-1.5" data-testid="work-timeline-live">
        <StepGroupLine actions={actions} sources={sources} expanded={liveOpen} onToggle={() => setExpanded(v => !v)} />
        {liveOpen && <StepList reasons={reasons} actions={actions} childrenOf={childrenOf} thoughtLabel={thoughtLabel} openIds={openIds} toggle={toggle} failureContext={failureContext} testId="work-steps-live" />}
      </div>
    );
  }

  const summary = [
    `${steps} step${steps === 1 ? '' : 's'}`,
    sources > 0 ? `${sources} source${sources === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  // The line says what the work WAS, from the steps' own finished labels.
  // A group of one step is that step — "Searched HubSpot · 12 records" says
  // more than any composition of it.
  const solo = actions.length === 1 && reasons.length === 0 && sources === 0 ? actions[0]! : null;
  const soloRadius = solo ? (solo.result ?? (solo.resultDetail && solo.resultDetail.length <= 60 ? solo.resultDetail : undefined)) : undefined;
  const headline = solo ? null : stepHeadline(actions.map(n => ({ kind: n.kind, status: n.status, label: n.label, tool: n.tool })), sources);
  const failed = actions.some(n => n.status === 'error');

  return (
    <div className="my-1.5" data-testid="work-group">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label={`${solo ? solo.label : headline} · ${summary}`}
        title={summary}
        className={`group/work flex w-full items-center gap-2 py-1 text-left text-xs transition hover:text-foreground ${failed ? 'text-muted-foreground' : 'text-muted-foreground/75'}`}
      >
        {solo ? <TraceMarker node={solo} /> : <Brain className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">
          {solo
            ? (
                <>
                  <span className={solo.status === 'error' ? 'text-[var(--brand-fail)]' : undefined}>{solo.kind === 'delegate' ? `→ ${solo.label}` : solo.label}</span>
                  {solo.detail && <span className="text-muted-foreground/60">{` · ${solo.detail}`}</span>}
                </>
              )
            : headline}
        </span>
        {solo && soloRadius && <span className="max-w-[38%] shrink-0 truncate font-mono text-[10px] text-muted-foreground/70">{soloRadius}</span>}
        <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground/50 transition group-hover/work:text-muted-foreground ${expanded ? 'rotate-90' : ''}`} aria-hidden />
      </button>
      {expanded && (
        <>
          {anyOpen && (
            <div className="mt-1 mb-1 flex justify-end">
              <button type="button" onClick={collapseAll} className="text-[11px] font-medium text-muted-foreground transition hover:text-foreground">
                Collapse all
              </button>
            </div>
          )}
          <ol className="mt-0.5 flex flex-col border-l border-border/50 pl-3" data-testid="work-steps">
            {reasons.length > 0 && (
              <ClaimLine
                id="__reasoning__"
                icon={<Brain className="size-3.5 text-brand-amber-deep" aria-hidden />}
                label={thoughtLabel}
                open={openIds.has('__reasoning__')}
                onToggle={() => toggle('__reasoning__')}
              >
                {reasons.map(r => (
                  <div key={r.id} className="max-h-72 overflow-y-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
                    {r.text?.trim() || r.label}
                  </div>
                ))}
              </ClaimLine>
            )}
            {actions.map((n) => {
              const kids = childrenOf(n.id);
              return (
                <ClaimLine
                  key={n.id}
                  id={n.id}
                  icon={<TraceMarker node={n} />}
                  label={n.kind === 'delegate' ? `→ ${n.label}` : n.label}
                  detail={n.detail}
                  radius={n.result ?? (n.resultDetail && n.resultDetail.length <= 60 ? n.resultDetail : undefined)}
                  error={n.status === 'error'}
                  open={openIds.has(n.id)}
                  onToggle={() => toggle(n.id)}
                >
                  {kids.length > 0
                    ? (
                        <ol className="relative">
                          {kids.map(k => (
                            <TraceRow key={k.id} node={k} nested open={openDrill === k.id} onToggle={() => setOpenDrill(o => (o === k.id ? null : k.id))} failureContext={failureContext} />
                          ))}
                        </ol>
                      )
                    : (
                        <div>
                          <CallDetail node={n} />
                          {n.status === 'error' && <FailureDetail node={n} context={failureContext} />}
                          {(n.citations?.length ?? 0) > 0 && <TraceCitations node={n} />}
                        </div>
                      )}
                </ClaimLine>
              );
            })}
            {sources > 0 && (
              <ClaimLine
                id="__sources__"
                icon={<Search className="size-3.5 text-muted-foreground/70" aria-hidden />}
                label={`Grounded in ${sources} source${sources === 1 ? '' : 's'}`}
                open={openIds.has('__sources__')}
                onToggle={() => toggle('__sources__')}
              >
                <div className="grid gap-1.5">
                  {documents.map((d, i) => <Citation key={`${d.document_id}-${i}`} doc={d} />)}
                </div>
              </ClaimLine>
            )}
          </ol>
        </>
      )}
    </div>
  );
}

/**
 * The live status line: what is happening now, shimmering, with a seconds
 * count from the start of the turn. Plain text and one CSS animation — no
 * spinner, no ping.
 * @param root0 - Component props.
 * @param root0.text - What the turn is on.
 * @param root0.elapsed - Seconds since the turn started.
 */
export function LiveStatus({ text, elapsed }: { text: string; elapsed: number }) {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 py-1 text-left text-xs text-muted-foreground" role="status" aria-live="polite">
      <span className="work-shimmer min-w-0 flex-1 truncate font-medium">{text}</span>
      {elapsed >= 1 && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
          {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
        </span>
      )}
    </div>
  );
}

/**
 * A live group, folded: what the steps so far add up to, one line, a tap
 * away from the rows.
 * @param root0 - Component props.
 * @param root0.actions - The group's steps so far.
 * @param root0.sources - Sources grounded so far.
 * @param root0.expanded - Whether the rows show.
 * @param root0.onToggle - Show or hide the rows.
 */
function StepGroupLine({ actions, sources, expanded, onToggle }: { actions: TraceNode[]; sources: number; expanded: boolean; onToggle: () => void }) {
  const text = actions.length === 1
    ? liveStepLabel(actions[0]!)
    : stepHeadline(actions.map(n => ({ kind: n.kind, status: n.status, label: n.label, tool: n.tool })), sources);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${text} · ${actions.length} step${actions.length === 1 ? '' : 's'}`}
      className="group/work flex w-full min-w-0 items-center gap-2 py-1 text-left text-xs text-muted-foreground/75 transition hover:text-foreground"
    >
      <Brain className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground/50 transition ${expanded ? 'rotate-90' : ''}`} aria-hidden />
    </button>
  );
}

/**
 * The rows of a group — reasoning first, then each step with a delegate's
 * steps under it. The same list live and after the turn.
 * @param root0 - Component props.
 * @param root0.reasons - Reasoning nodes.
 * @param root0.actions - Step nodes.
 * @param root0.childrenOf - A delegate's steps.
 * @param root0.thoughtLabel - "Thought for 6s".
 * @param root0.openIds - Which rows are open.
 * @param root0.toggle - Open or close a row.
 * @param root0.failureContext - Stamped into a failed step's Copy details.
 * @param root0.testId - The list's test id.
 */
function StepList({ reasons, actions, childrenOf, thoughtLabel, openIds, toggle, failureContext, testId }: {
  reasons: TraceNode[];
  actions: TraceNode[];
  childrenOf: (id: string) => TraceNode[];
  thoughtLabel: string;
  openIds: Set<string>;
  toggle: (id: string) => void;
  failureContext?: FailureReport;
  testId: string;
}) {
  const reasonText = reasons.map(r => r.text?.trim() || '').filter(Boolean).join('\n\n');
  return (
    <ol className="mt-0.5 flex min-w-0 flex-col border-l border-border/50 pl-3" data-testid={testId}>
      {reasons.length > 0 && (
        <ClaimLine
          id="__reasoning__"
          icon={<Brain className="size-3.5 text-brand-amber-deep" aria-hidden />}
          label={thoughtLabel}
          open={openIds.has('__reasoning__')}
          onToggle={reasonText ? () => toggle('__reasoning__') : undefined}
        >
          <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{reasonText}</div>
        </ClaimLine>
      )}
      {actions.map(n => (
        <li key={n.id} className="min-w-0">
          <ol>
            <TraceRow node={n} open={openIds.has(n.id)} onToggle={() => toggle(n.id)} failureContext={failureContext} />
            {childrenOf(n.id).map(k => (
              <TraceRow key={k.id} node={k} nested open={openIds.has(k.id)} onToggle={() => toggle(k.id)} failureContext={failureContext} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

/**
 * One step line: the claim, quiet, with the blast radius priced on the line
 * so the reader can decide whether the expansion is worth it
 * (agent-chat-surface.md §2). Tapping the line reveals what is behind it.
 * Every step in the chat — live or finished, root or nested — is this line.
 * @param root0 - Component props.
 * @param root0.id - Stable identity for the open set.
 * @param root0.icon - The kind marker.
 * @param root0.label - The claim, in outcome language.
 * @param root0.detail - Input summary shown beside the claim.
 * @param root0.radius - The blast radius or compact result on the line.
 * @param root0.error - Renders the claim in the failure color.
 * @param root0.nested - Indented under a delegate.
 * @param root0.open - Whether the line is expanded.
 * @param root0.onToggle - Expand or collapse this line; absent when there is nothing behind it.
 * @param root0.after - Shown under the line whether or not it is open (a failure, citations).
 * @param root0.children - What the line expands to.
 */
function ClaimLine({ id, icon, label, detail, radius, error, nested, open, onToggle, after, children }: {
  id: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
  radius?: string;
  error?: boolean;
  nested?: boolean;
  open: boolean;
  onToggle?: () => void;
  after?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const line = (
    <>
      <span className="grid size-4 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">
        <span className={`font-medium ${error ? 'text-[var(--brand-fail)]' : 'text-foreground/85'}`}>{label}</span>
        {detail && (
          <span className="text-muted-foreground">
            {' · '}
            {detail}
          </span>
        )}
      </span>
      {radius && <span className="max-w-[38%] shrink-0 truncate font-mono text-[10px] text-muted-foreground/80">{radius}</span>}
    </>
  );
  return (
    <li data-claim={id} className={`min-w-0 ${nested ? 'ml-4 border-l border-border/50 pl-2' : ''}`}>
      {onToggle
        ? (
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 py-1 text-left text-xs transition hover:text-foreground">
              {line}
              <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground/70 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          )
        : <div className="flex w-full min-w-0 items-center gap-2 py-1 text-xs">{line}</div>}
      {open && children && <div className="mb-2 ml-6 min-w-0">{children}</div>}
      {after && <div className="ml-6 min-w-0">{after}</div>}
    </li>
  );
}

function LegacyWorkTimeline({ runs, streaming, activity, thinkingText, documents = [], inspect = 0 }: Omit<WorkTimelineProps, 'trace'>) {
  const [open, setOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState<number | null>(null);
  const elapsed = useElapsed(streaming);
  useEffect(() => {
    if (inspect > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
      setOpen(true);
    }
  }, [inspect]);

  // Curate: hide plumbing from the trace and the counts.
  const visible = runs.filter(r => !PLUMBING.has(r.name));
  const nodes = visible.map(toNode);
  const specialists = visible.filter(r => r.name === 'task').length;
  const errors = nodes.filter(n => n.state === 'error').length;
  const sources = documents.length;
  const hasReasoning = Boolean(thinkingText && thinkingText.trim().length > 0);
  const hasDetail = nodes.length > 0 || hasReasoning || sources > 0;

  if (nodes.length === 0 && !streaming && !hasReasoning && sources === 0) {
    return null;
  }

  const summary = [
    `${nodes.length} step${nodes.length === 1 ? '' : 's'}`,
    specialists > 0 ? `${specialists} specialist${specialists === 1 ? '' : 's'}` : null,
    sources > 0 ? `${sources} source${sources === 1 ? '' : 's'}` : null,
    errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  const pending = visible.filter(r => r.state === 'pending');
  const livePending = pending.length > 0
    ? describeToolCall(pending[pending.length - 1]!.name, pending[pending.length - 1]!.input ?? {}, true).label
    : null;
  const legacyKind = (k: Kind): 'tool' | 'search' | 'delegate' | 'draft' => (k === 'delegation' ? 'delegate' : k === 'search' ? 'search' : k === 'draft' || k === 'proposal' ? 'draft' : 'tool');
  const headline = stepHeadline(nodes.map(n => ({ kind: legacyKind(n.kind), status: n.state === 'pending' ? 'progress' : n.state, label: n.label })), sources);
  const headerText = streaming ? (activity ?? livePending ?? 'Working…') : headline;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(v => !v)}
        aria-expanded={open}
        aria-label={streaming ? headerText : `${headline} · ${summary}`}
        disabled={!hasDetail}
        className="flex w-full items-center gap-2 py-1 text-left text-xs text-muted-foreground/75 transition enabled:hover:text-foreground"
      >
        {streaming
          ? <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
          : <Brain className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
        <span className={`min-w-0 flex-1 truncate ${streaming ? 'work-shimmer font-medium' : ''}`}>{headerText}</span>
        {streaming && elapsed >= 3 && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
            {elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}
          </span>
        )}
        {hasDetail && <ChevronDown className={`size-3.5 shrink-0 text-muted-foreground/70 transition ${open ? 'rotate-180' : ''}`} aria-hidden />}
      </button>

      {open && hasDetail && (
        <>
          <button type="button" aria-label="Close details" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 sm:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-border bg-background shadow-2xl sm:static sm:z-auto sm:mt-1 sm:max-h-none sm:rounded-xl sm:border sm:border-border/60 sm:bg-muted/20 sm:shadow-none">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 sm:px-3">
              <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Activity</span>
              {streaming
                ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-amber-deep">
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-amber-deep/50" />
                        <span className="relative inline-flex size-2 rounded-full bg-brand-amber-deep" />
                      </span>
                      live
                    </span>
                  )
                : (
                    <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:hidden">
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
            </div>

            {/* trace */}
            <ol className="relative px-4 py-2 sm:px-3">
              {hasReasoning && (
                <li className="relative py-2 pl-7">
                  <span className="absolute top-2.5 left-0"><Brain className="size-3.5 text-brand-amber-deep" aria-hidden /></span>
                  <button type="button" onClick={() => setReasoningOpen(v => !v)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-foreground/90 transition hover:text-foreground">
                    Reasoning &amp; data reviewed
                    <ChevronRight className={`size-3 transition ${reasoningOpen ? 'rotate-90' : ''}`} aria-hidden />
                  </button>
                  <span className={`mt-1.5 block rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground ${reasoningOpen ? 'max-h-72 overflow-y-auto' : 'line-clamp-2'}`}>
                    {thinkingText}
                  </span>
                </li>
              )}
              {nodes.map((n, i) => (
                <li key={i} className="relative py-2 pl-7">
                  <span className="absolute top-2.5 left-0"><Marker node={n} /></span>
                  <div className="text-[13px] leading-snug">
                    <span className={`font-semibold ${n.state === 'error' ? 'text-[var(--brand-fail)]' : n.kind === 'delegation' ? 'text-brand-amber-deep' : 'text-foreground/90'}`}>{n.label}</span>
                    {n.detail && <span className="ml-1.5 text-muted-foreground">{n.detail}</span>}
                  </div>
                  {n.drill && (
                    n.drillLabel
                      ? (
                          <>
                            <button type="button" onClick={() => setDrillOpen(o => (o === i ? null : i))} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand-amber-deep">
                              {n.drillLabel}
                              <ChevronRight className={`size-3 transition ${drillOpen === i ? 'rotate-90' : ''}`} aria-hidden />
                            </button>
                            {drillOpen === i && (
                              <span className="mt-1 block rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed break-words text-muted-foreground">{n.drill}</span>
                            )}
                          </>
                        )
                      : <span className="mt-0.5 line-clamp-2 block text-[11px] break-words text-muted-foreground/70">{n.drill}</span>
                  )}
                </li>
              ))}
            </ol>

            {sources > 0 && (
              <div className="border-t border-border px-4 py-3 sm:px-3">
                <div className="mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">Grounded in</div>
                <div className="grid gap-1.5">
                  {documents.slice(0, 8).map((d, i) => <Citation key={`${d.document_id}-${i}`} doc={d} />)}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
