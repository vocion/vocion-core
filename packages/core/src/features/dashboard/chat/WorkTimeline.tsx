'use client';

import type { AgentRun, IndexedDocument } from './types';
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  GitBranch,
  Loader2,
  type LucideIcon,
  PencilLine,
  Rows3,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { sourceLabels } from './helpers';

/**
 * WorkTimeline — the agent Activity trace (redesign).
 *
 * Minimal by default: one collapsed line ("Worked it out · 5 steps · 1
 * specialist · 3 sources"). Tap to explore a curated, typed trace — reasoning,
 * meaningful tool steps (plumbing hidden), delegation to named specialists,
 * and first-class citations. Bottom drawer on mobile, inline panel on desktop.
 */

export type WorkTimelineProps = {
  runs: Extract<AgentRun, { type: 'tool' }>[];
  streaming: boolean;
  activity?: string | null;
  thinkingText?: string;
  /** Sources the answer drew on — rendered as citations inside the trace. */
  documents?: IndexedDocument[];
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
    case 'run_operation': return { kind: 'skill', icon: Wrench };
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
      return { label: live ? `Proposing ${actionId}${conf}…` : `Proposed ${actionId}${conf}`, detail: live ? undefined : 'queued for your approval' };
    }
    case 'create_artifact':
      return { label: live ? 'Creating artifact…' : 'Created artifact', detail: String(input.kind ?? '') || undefined };
    case 'request_human_review':
      return { label: live ? 'Requesting approval…' : 'Requested approval' };
    case 'run_operation':
      return { label: `${live ? 'Running' : 'Ran'} skill: ${String(input.operation ?? input.slug ?? '')}` };
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
    return { icon: CircleAlert, kind: 'generic', label: 'Error', detail: String(run.output ?? '').slice(0, 160), state: 'error' };
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

function useElapsed(active: boolean): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    if (!active) {
      return;
    }
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return Math.floor((now - start) / 1000);
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
    <a href={doc.link} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2 transition hover:border-brand-amber/40">
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{doc.semantic_identifier}</span>
        {doc.blurb && <span className="block truncate text-[11px] text-muted-foreground">{doc.blurb}</span>}
      </span>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
    </a>
  );
}

export function WorkTimeline({ runs, streaming, activity, thinkingText, documents = [] }: WorkTimelineProps) {
  const [open, setOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState<number | null>(null);
  const elapsed = useElapsed(streaming);

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
  const headerText = streaming ? (activity ?? livePending ?? 'Working…') : `Worked it out · ${summary}`;

  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(v => !v)}
        aria-expanded={open}
        disabled={!hasDetail}
        className="flex w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground transition enabled:hover:text-foreground"
      >
        {streaming
          ? <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-amber-deep" aria-hidden />
          : <Brain className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />}
        <span className="min-w-0 flex-1 truncate font-medium">{headerText}</span>
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
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-3">
              <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Activity</span>
              {streaming
                ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-amber-deep">
                      <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-amber-deep/50" /><span className="relative inline-flex size-2 rounded-full bg-brand-amber-deep" /></span>
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
                  <span className={`mt-1.5 block break-words whitespace-pre-wrap rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground ${reasoningOpen ? 'max-h-72 overflow-y-auto' : 'line-clamp-2'}`}>
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
                              <span className="mt-1 block break-words rounded-lg bg-muted/50 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">{n.drill}</span>
                            )}
                          </>
                        )
                      : <span className="mt-0.5 line-clamp-2 block break-words text-[11px] text-muted-foreground/70">{n.drill}</span>
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
