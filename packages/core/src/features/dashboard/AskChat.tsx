'use client';

import { Bot, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, RefreshCw, Search, Send, Sparkles, ThumbsDown, ThumbsUp, User, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { ContextMenu } from '@/features/dashboard/ContextMenu';
import { EmailDraftCard } from '@/features/dashboard/EmailDraftCard';
import { FeedbackButtons } from '@/features/dashboard/FeedbackButtons';
import { ProposalCard } from '@/features/dashboard/ProposalCard';

type OnyxDocument = {
  document_id: string;
  semantic_identifier: string;
  link: string;
  source_type: string;
  blurb: string;
  metadata?: Record<string, string>;
  updated_at?: string;
};

type ThinkingStep = {
  type: 'thinking' | 'search' | 'skill';
  content: string;
  documents?: OnyxDocument[];
  queries?: string[];
  skillSlug?: string;
};

type SkillResult = {
  skillName: string;
  skillSlug: string;
  runId: number;
  content: string;
  status: 'pending' | 'auto';
  prospectName?: string;
  prospectCompany?: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  documents?: OnyxDocument[];
  citationCount?: number;
  thinkingSteps?: ThinkingStep[];
  thinkingSeconds?: number;
  skillResults?: SkillResult[];
};

/* ------------------------------------------------------------------ */
/* Elapsed timer hook                                                 */
/* ------------------------------------------------------------------ */
const useElapsed = (running: boolean) => {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setSeconds(0); // eslint-disable-line react-hooks/set-state-in-effect -- reset timer on stop
      return;
    }
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setSeconds(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  return seconds;
};

/* ------------------------------------------------------------------ */
/* Source colors & labels                                              */
/* ------------------------------------------------------------------ */
const sourceColors: Record<string, string> = {
  hubspot: '#FF7A59',
  google_drive: '#4285F4',
  gmail: '#EA4335',
  zoom: '#2D8CFF',
  slack: '#4A154B',
  salesforce: '#00A1E0',
  google_calendar: '#0F9D58',
};

const sourceLabels: Record<string, string> = {
  hubspot: 'HubSpot',
  google_drive: 'Drive',
  gmail: 'Gmail',
  zoom: 'Zoom',
  slack: 'Slack',
  salesforce: 'Salesforce',
  google_calendar: 'Calendar',
};

/* ------------------------------------------------------------------ */
/* Thinking panel (completed — collapsible)                           */
/* ------------------------------------------------------------------ */
const ThinkingPanel = ({ steps, seconds }: { steps: ThinkingStep[]; seconds?: number }) => {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) {
    return null;
  }

  const stepCount = steps.length;

  return (
    <div className="mb-3" data-thinking-panel>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="font-medium">
          Thought for
          {seconds ? ` ${seconds}s` : ''}
        </span>
        <span className="text-muted-foreground/60">
          {stepCount}
          {' '}
          {stepCount === 1 ? 'step' : 'steps'}
        </span>
      </button>
      {open && (
        <div className="mt-2 ml-1 space-y-3 border-l-2 border-border/50 pl-4" data-thinking-steps>
          {steps.map((step, i) => (
            <div key={i} data-step-index={i} className="transition-all">
              {step.type === 'thinking' && step.content && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">Thinking</div>
                  <div className="text-xs leading-relaxed text-muted-foreground/80">
                    <Markdown remarkPlugins={[remarkGfm]}>{step.content}</Markdown>
                  </div>
                </div>
              )}
              {step.type === 'skill' && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Sparkles className="size-3" />
                    Running skill
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <a
                      href={`/en/dashboard/operations/${step.skillSlug}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                    >
                      <Sparkles className="size-2.5" />
                      {step.queries?.[0] ?? step.skillSlug}
                    </a>
                  </div>
                  {step.content && step.content !== 'Running...' && (
                    <div className="mt-1 text-[10px] text-muted-foreground/60">{step.content}</div>
                  )}
                </div>
              )}
              {step.type === 'search' && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Search className="size-3" />
                    Searching internal documents
                  </div>
                  {step.queries && step.queries.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {step.queries.map(q => (
                        <span key={q} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          <Search className="size-2.5" />
                          {q}
                        </span>
                      ))}
                    </div>
                  )}
                  {step.content && step.content !== 'Searching...' && (
                    <div className="mb-1.5 text-[10px] text-muted-foreground/60">{step.content}</div>
                  )}
                  {step.documents && step.documents.length > 0 && (
                    <>
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground">Reading</div>
                      <div className="flex flex-wrap gap-1">
                        {step.documents.slice(0, 6).map((doc) => {
                          const color = sourceColors[doc.source_type] ?? '#888';
                          return (
                            <span
                              key={doc.document_id}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ backgroundColor: `${color}15`, color }}
                            >
                              <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
                              <span className="max-w-32 truncate">{doc.semantic_identifier}</span>
                            </span>
                          );
                        })}
                        {step.documents.length > 6 && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            +
                            {step.documents.length - 6}
                            {' '}
                            more
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Live streaming thinking (in-progress — always visible)             */
/* ------------------------------------------------------------------ */
const LiveThinking = ({
  steps,
  phase,
  thinkingText,
  searchQueries,
  searchDocs,
  elapsed,
}: {
  steps: ThinkingStep[];
  phase: 'idle' | 'thinking' | 'searching' | 'answering';
  thinkingText: string;
  searchQueries: string[];
  searchDocs: OnyxDocument[];
  elapsed: number;
}) => {
  const [expanded, setExpanded] = useState(false);
  const isActive = phase === 'thinking' || phase === 'searching';
  if (!isActive && steps.length === 0) {
    return null;
  }
  if (phase === 'answering') {
    return steps.length > 0 ? <ThinkingPanel steps={steps} seconds={elapsed} /> : null;
  }

  // Latest step summary for collapsed view
  const latestStep = steps[steps.length - 1];
  const latestSummary = thinkingText
    || (latestStep?.type === 'skill' && latestStep.queries?.[0] ? `Running skill: ${latestStep.queries[0]}` : '')
    || (latestStep?.type === 'search' && latestStep.queries?.[0] ? `Searching: ${latestStep.queries[0]}` : '')
    || (latestStep?.content ?? '');

  // Dynamic phase label based on what's actually happening
  const phaseLabel = latestStep?.type === 'skill'
    ? 'Running skill'
    : phase === 'searching' || latestStep?.type === 'search'
      ? 'Searching'
      : thinkingText?.toLowerCase().includes('skill')
        ? 'Running skill'
        : thinkingText?.toLowerCase().includes('search')
          ? 'Searching'
          : 'Thinking';

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <Loader2 className="size-3 animate-spin" />
        <span className="font-medium">
          {phaseLabel}
          {elapsed > 0 ? ` ${elapsed}s` : ''}
        </span>
        {steps.length > 0 && (
          <span className="text-muted-foreground/60">
            {steps.length + (isActive ? 1 : 0)}
            {' '}
            steps
          </span>
        )}
        {!expanded && latestSummary && (
          <span className="max-w-xs truncate text-muted-foreground/50">{latestSummary}</span>
        )}
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      </button>

      {expanded && (
        <div className="mt-2 ml-1 space-y-3 border-l-2 border-border/50 pl-4">
          {/* Completed steps */}
          {steps.map((step, i) => (
            <div key={i}>
              {step.type === 'thinking' && step.content && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">Thinking</div>
                  <div className="line-clamp-4 text-xs leading-relaxed text-muted-foreground/80">
                    <Markdown remarkPlugins={[remarkGfm]}>{step.content}</Markdown>
                  </div>
                </div>
              )}
              {step.type === 'skill' && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Sparkles className="size-3" />
                    Running skill
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <a
                      href={`/en/dashboard/operations/${step.skillSlug}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                    >
                      <Sparkles className="size-2.5" />
                      {step.queries?.[0] ?? step.skillSlug}
                    </a>
                  </div>
                  {step.content && step.content !== 'Running...' && (
                    <div className="mt-1 text-[10px] text-muted-foreground/60">{step.content}</div>
                  )}
                </div>
              )}
              {step.type === 'search' && (
                <div>
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Search className="size-3" />
                    Searching internal documents
                  </div>
                  {step.queries && step.queries.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {step.queries.map(q => (
                        <span key={q} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          <Search className="size-2.5" />
                          {q}
                        </span>
                      ))}
                    </div>
                  )}
                  {step.content && step.content !== 'Searching...' && (
                    <div className="mb-1 text-[10px] text-muted-foreground/60">{step.content}</div>
                  )}
                  {step.documents && step.documents.length > 0 && (
                    <>
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground">Reading</div>
                      <div className="flex flex-wrap gap-1">
                        {step.documents.slice(0, 5).map((doc) => {
                          const color = sourceColors[doc.source_type] ?? '#888';
                          return (
                            <span
                              key={doc.document_id}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ backgroundColor: `${color}15`, color }}
                            >
                              <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
                              <span className="max-w-32 truncate">{doc.semantic_identifier}</span>
                            </span>
                          );
                        })}
                        {step.documents.length > 5 && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            +
                            {step.documents.length - 5}
                            {' '}
                            more
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Current active step */}
          {phase === 'thinking' && (
            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Thinking</div>
              {thinkingText && (
                <div className="line-clamp-3 text-xs leading-relaxed text-muted-foreground/80">
                  <Markdown remarkPlugins={[remarkGfm]}>{thinkingText}</Markdown>
                </div>
              )}
            </div>
          )}

          {phase === 'searching' && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Search className="size-3 animate-pulse" />
                Searching internal documents
              </div>
              {searchQueries.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {searchQueries.map(q => (
                    <span key={q} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {q}
                    </span>
                  ))}
                </div>
              )}
              {searchDocs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {searchDocs.slice(0, 5).map(doc => (
                    <Badge key={doc.document_id} variant="secondary" className="text-[10px]">
                      {doc.semantic_identifier}
                    </Badge>
                  ))}
                  {searchDocs.length > 5 && (
                    <Badge variant="outline" className="text-[10px]">
                      +
                      {searchDocs.length - 5}
                      {' '}
                      more
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Display helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Build a human-readable title for a document.
 * Zoom meetings often have generic "Zoom Meeting" titles — we enhance those
 * with metadata like prospect name, call type, host, or summary excerpt.
 * @param doc
 */
function getDisplayTitle(doc: OnyxDocument): string {
  const raw = doc.semantic_identifier ?? '';
  const meta = doc.metadata ?? {};
  const isGeneric = /^zoom meeting$/i.test(raw.trim());

  if (!isGeneric) {
    return raw;
  }

  // Build from metadata
  const parts: string[] = [];

  if (meta.prospect_name) {
    parts.push(meta.prospect_name);
    if (meta.prospect_company) {
      parts.push(`(${meta.prospect_company})`);
    }
  } else if (meta.attendees) {
    const attendees = Array.isArray(meta.attendees)
      ? (meta.attendees as unknown as string[])
      : (meta.attendees as string).split(',').map(s => s.trim());
    // Show first 2 attendees, skip the host
    const host = meta.host?.split('@')[0]?.toLowerCase();
    const others = attendees.filter(a => a.toLowerCase() !== host && !a.includes('@'));
    if (others.length > 0) {
      parts.push(others.slice(0, 2).join(' & '));
    }
  }

  if (meta.call_type && meta.call_type !== 'other') {
    parts.push(`— ${meta.call_type}`);
  }

  if (parts.length > 0) {
    return parts.join(' ');
  }

  // Fallback: extract first meaningful line from blurb
  const blurb = doc.blurb ?? '';
  const summaryMatch = blurb.match(/## Summary\n(.+)/);
  if (summaryMatch?.[1]) {
    const firstSentence = summaryMatch[1].split(/[.!?]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 10) {
      return firstSentence.length > 60 ? `${firstSentence.slice(0, 57)}...` : firstSentence;
    }
  }

  // Last resort: host + date
  if (meta.host) {
    const hostName = meta.host.split('@')[0] ?? meta.host;
    return `${hostName}'s meeting`;
  }

  return raw;
}

/**
 * Clean blurb for display — strip ## Summary header, raw transcript noise.
 * @param blurb
 */
function getCleanBlurb(blurb: string): string {
  let text = blurb;
  // Strip markdown headers
  text = text.replace(/^## (Summary|Transcript)\n?/gm, '');
  // Strip "Meeting: Zoom Meeting Duration: X minutes Host: ..." boilerplate
  text = text.replace(/^Meeting:.*(?=\n|$)/m, '');
  text = text.replace(/^Duration:.*(?=\n|$)/m, '');
  text = text.replace(/^Host:.*(?=\n|$)/m, '');
  text = text.replace(/^Call type:.*(?=\n|$)/m, '');
  text = text.replace(/^Prospect:.*(?=\n|$)/m, '');
  text = text.replace(/^Company\/Project:.*(?=\n|$)/m, '');
  text = text.replace(/^Budget:.*(?=\n|$)/m, '');
  text = text.replace(/^Timeline:.*(?=\n|$)/m, '');
  text = text.replace(/^Recording available.*(?=\n|$)/m, '');
  // Clean up multiple newlines
  text = text.replace(/\n{2,}/g, '\n').trim();
  return text;
}

/* ------------------------------------------------------------------ */
/* Document preview panel                                              */
/* ------------------------------------------------------------------ */
const DocumentPreview = ({ doc, num, onClose }: {
  doc: OnyxDocument;
  num?: string;
  onClose: () => void;
}) => {
  const color = sourceColors[doc.source_type] ?? '#888';
  const label = sourceLabels[doc.source_type] ?? doc.source_type;
  const meta = doc.metadata ?? {};
  const displayTitle = getDisplayTitle(doc);

  // Parse summary from blurb (our Zoom enrichment prepends "## Summary\n...")
  let summary = '';
  let restBlurb = doc.blurb ?? '';
  if (restBlurb.includes('## Summary')) {
    const summaryStart = restBlurb.indexOf('## Summary');
    const afterHeader = restBlurb.slice(summaryStart + '## Summary'.length).trimStart();
    const nextSection = afterHeader.indexOf('\n##');
    if (nextSection >= 0) {
      summary = afterHeader.slice(0, nextSection).trim();
      restBlurb = afterHeader.slice(nextSection).trim();
    } else {
      // Split on double-newline to separate summary from transcript/content
      const doubleLF = afterHeader.indexOf('\n\n');
      if (doubleLF >= 0) {
        summary = afterHeader.slice(0, doubleLF).trim();
        restBlurb = afterHeader.slice(doubleLF).trim();
      } else {
        summary = afterHeader.trim();
        restBlurb = '';
      }
    }
  }
  restBlurb = getCleanBlurb(restBlurb);

  // Format date
  let dateStr = '';
  if (doc.updated_at) {
    try {
      dateStr = new Date(doc.updated_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    } catch { /* skip */ }
  }

  // Collect metadata entries to display
  const metaEntries: Array<{ label: string; value: string }> = [];
  if (dateStr) {
    metaEntries.push({ label: 'Date', value: dateStr });
  }
  if (meta.duration_minutes) {
    metaEntries.push({ label: 'Duration', value: `${meta.duration_minutes} min` });
  }
  if (meta.host) {
    metaEntries.push({ label: 'Host', value: meta.host });
  }
  if (meta.call_type) {
    metaEntries.push({ label: 'Call Type', value: meta.call_type });
  }
  if (meta.prospect_name) {
    metaEntries.push({ label: 'Prospect', value: meta.prospect_name });
  }
  if (meta.prospect_company) {
    metaEntries.push({ label: 'Company', value: meta.prospect_company });
  }
  if (meta.budget_signals) {
    metaEntries.push({ label: 'Budget', value: meta.budget_signals });
  }
  if (meta.timeline) {
    metaEntries.push({ label: 'Timeline', value: meta.timeline });
  }
  if (meta.topics) {
    metaEntries.push({ label: 'Topics', value: Array.isArray(meta.topics) ? (meta.topics as unknown as string[]).join(', ') : meta.topics });
  }
  if (meta.attendees) {
    metaEntries.push({ label: 'Attendees', value: Array.isArray(meta.attendees) ? (meta.attendees as unknown as string[]).join(', ') : meta.attendees });
  }

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="relative mx-4 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-popover shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {num ?? label[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-snug font-semibold">{displayTitle}</div>
            {displayTitle !== doc.semantic_identifier && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{doc.semantic_identifier}</div>
            )}
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="rounded px-1.5 py-0.5 font-medium" style={{ backgroundColor: `${color}15`, color }}>{label}</span>
              {dateStr && <span>{dateStr}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Summary */}
          {summary && (
            <div className="mb-4">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Summary</div>
              <div className="text-sm leading-relaxed whitespace-pre-line">{summary}</div>
            </div>
          )}

          {/* Metadata grid */}
          {metaEntries.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Details</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {metaEntries.map(entry => (
                  <div key={entry.label}>
                    <div className="text-[10px] text-muted-foreground">{entry.label}</div>
                    <div className="text-sm font-medium">{entry.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content / Blurb */}
          {restBlurb && (
            <div className="mb-4">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Content</div>
              <div className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {restBlurb.split('\n').filter(Boolean).map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {/* Remaining metadata as key-value pairs */}
          {Object.keys(meta).length > metaEntries.length && (
            <div className="mb-4">
              <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Raw Metadata</div>
              <div className="rounded-md bg-muted/50 p-2 font-mono text-[11px]">
                {Object.entries(meta)
                  .filter(([k]) => !['duration_minutes', 'host', 'call_type', 'prospect_name', 'prospect_company', 'budget_signals', 'timeline', 'topics', 'attendees', 'meeting_id'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="py-0.5">
                      <span className="text-muted-foreground">
                        {k}
                        :
                      </span>
                      {' '}
                      <span>{Array.isArray(v) ? (v as string[]).join(', ') : String(v)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer with link */}
        {doc.link && (
          <div className="border-t border-border px-5 py-3">
            <a
              href={doc.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div>
                  Open in
                  {label}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{doc.link}</div>
              </div>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Citation badge with hover popover                                   */
/* ------------------------------------------------------------------ */
const CitationBadge = ({ num, sourceType, document: doc, onOpenSidebar, onPreview }: {
  num: string;
  onClick?: () => void;
  sourceType?: string;
  document?: OnyxDocument;
  onOpenSidebar?: () => void;
  onPreview?: (doc: OnyxDocument, num: string) => void;
}) => {
  const color = sourceType ? sourceColors[sourceType] : undefined;
  const label = sourceType ? (sourceLabels[sourceType] ?? sourceType.replace('_', ' ')) : null;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (doc && onPreview) {
      onPreview(doc, num);
    } else {
      onOpenSidebar?.();
    }
  };

  // For thinking step references (no source label), render simple numbered button
  if (!label || !color) {
    return (
      <button
        type="button"
        onClick={() => {
          const panel = document.querySelector('[data-thinking-panel]');
          if (panel) {
            const toggle = panel.querySelector('button');
            const isOpen = panel.querySelector('[data-thinking-steps]');
            if (!isOpen && toggle) {
              toggle.click();
            }
            setTimeout(() => {
              const step = panel.querySelector(`[data-step-index="${Number(num) - 1}"]`);
              if (step) {
                step.scrollIntoView({ behavior: 'smooth', block: 'center' });
                step.classList.add('ring-2', 'ring-primary/50', 'rounded-md');
                setTimeout(() => step.classList.remove('ring-2', 'ring-primary/50', 'rounded-md'), 2000);
              }
            }, 100);
          }
        }}
        className="mx-0.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-full bg-muted align-middle text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
        title={`View thinking step ${num}`}
      >
        {num}
      </button>
    );
  }

  // Pure CSS hover tooltip — no state management, no glitchy open/close
  const title = doc ? getDisplayTitle(doc) : '';
  const blurb = doc ? getCleanBlurb(doc.blurb ?? '') : '';

  return (
    <span className="group/cite relative inline-block">
      <button
        type="button"
        className="mx-0.5 inline-flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 align-middle text-[11px] font-medium transition-opacity hover:opacity-80"
        style={{ backgroundColor: `${color}18`, color }}
        onClick={handleClick}
      >
        {label}
      </button>
      {doc && (
        <div className="pointer-events-none absolute bottom-full left-0 z-[200] mb-1.5 w-72 rounded-lg border border-border bg-popover p-3 opacity-0 shadow-lg transition-opacity duration-150 group-hover/cite:pointer-events-auto group-hover/cite:opacity-100">
          <div className="flex items-center gap-2">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {label[0]?.toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
          </div>
          {doc.metadata?.call_type && (
            <div className="mt-1.5 flex items-center gap-2 text-[10px]">
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{doc.metadata.call_type}</span>
              {doc.metadata?.duration_minutes && (
                <span className="text-muted-foreground">
                  {doc.metadata.duration_minutes}
                  {' '}
                  min
                </span>
              )}
              {doc.metadata?.host && <span className="text-muted-foreground">{doc.metadata.host}</span>}
            </div>
          )}
          {blurb && (
            <div className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{blurb}</div>
          )}
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{label}</span>
            <span>
              #
              {num}
            </span>
            <span className="ml-auto text-muted-foreground/60">Click to preview</span>
          </div>
        </div>
      )}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/* Citation rendering helper                                          */
/* ------------------------------------------------------------------ */

function renderWithCitations(
  children: React.ReactNode,
  onCitationClick?: (n: number) => void,
  documents?: OnyxDocument[],
  onAction?: (msg: string) => void,
  onOpenSidebar?: () => void,
  onPreview?: (doc: OnyxDocument, num: string) => void,
  seenDocIds?: Set<string>,
): React.ReactNode {
  if (!children) {
    return children;
  }

  // Process arrays of children
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{renderWithCitations(child, onCitationClick, documents, onAction, onOpenSidebar, onPreview, seenDocIds)}</span>
    ));
  }

  // Only process string children
  if (typeof children !== 'string') {
    return children;
  }

  if (!/CITE_\d+_/.test(children) && !/DISCO_/.test(children)) {
    return children;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = /CITE_(\d+)_|DISCO_(discovery|deal|account)_(.*?)_ENDDISCO/g;
  if (!seenDocIds) {
    seenDocIds = new Set<string>();
  }
  let match = regex.exec(children);

  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(children.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // CITE_N_ → CitationBadge
      const num = match[1];
      const docIndex = Number.parseInt(num, 10) - 1;
      const doc = documents?.[docIndex];

      parts.push(
        <CitationBadge
          key={`cite-${match.index}`}
          num={num}
          sourceType={doc?.source_type}
          document={doc}
          onClick={() => onCitationClick?.(Number.parseInt(num, 10))}
          onOpenSidebar={onOpenSidebar}
          onPreview={onPreview}
        />,
      );
    } else if (match[2]) {
      // DISCO_type_name_ENDDISCO → ContextMenu
      const objType = match[2];
      const objName = match[3] ?? '';

      parts.push(
        <ContextMenu
          key={`obj-${match.index}`}
          title={objName}
          objectType={`${objType}_call`}
          sourceType="zoom"
          onAction={onAction ?? (() => {})}
        >
          <strong>{objName}</strong>
        </ContextMenu>,
      );
    }

    lastIndex = regex.lastIndex;
    match = regex.exec(children);
  }

  if (lastIndex < children.length) {
    parts.push(children.slice(lastIndex));
  }

  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/* Markdown renderer                                                  */
/* ------------------------------------------------------------------ */
const MarkdownContent = ({ content, onCitationClick, documents, onAction, onOpenSidebar, onPreview }: { content: string; onCitationClick?: (n: number) => void; documents?: OnyxDocument[]; onAction?: (msg: string) => void; onOpenSidebar?: () => void; onPreview?: (doc: OnyxDocument, num: string) => void }) => {
  // Shared dedup set across all text nodes in this message — reset via key change
  const seenDocIdsRef = useRef(new Set<string>());
  useEffect(() => {
    seenDocIdsRef.current = new Set<string>();
  }, [content]);

  // MINIMAL processing: convert citations and discovery markers
  const processed = content
    // 1. Convert [N] to CITE_N_ (plain ASCII, survives markdown)
    .replace(/<cite>(\d+)<\/cite>/g, 'CITE_$1_')
    .replace(/\[\[(\d+)\]\]\([^)]*\)/g, 'CITE_$1_')
    .replace(/(?<!\[)(?<!\()\[(\d{1,2})\](?!\()/g, 'CITE_$1_')
    // 2. Convert <<discovery:Name|id>> to DISCO_type_name_ markers (plain ASCII)
    .replace(/<<(discovery|deal|account):(.*?)(?:\|\w*)?>>\u200B?/g, 'DISCO_$1_$2_ENDDISCO');

  return (
    <div className="prose max-w-none overflow-hidden text-[15px] leading-relaxed dark:prose-invert prose-headings:mt-5 prose-headings:mb-2 prose-headings:text-base prose-headings:font-semibold prose-p:my-2 prose-a:text-primary prose-strong:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-ol:my-2 prose-ul:my-2 prose-li:my-0.5" style={{ overflowWrap: 'anywhere' }}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children, ...props }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm" {...props}>{children}</table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="border-b border-border bg-muted/50" {...props}>{children}</thead>
          ),
          th: ({ children, ...props }) => (
            <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground" {...props}>{children}</th>
          ),
          tr: ({ children, ...props }) => (
            <tr className="transition-colors hover:bg-muted/30" {...props}>{children}</tr>
          ),
          // Intercept text nodes to render citation markers as badges
          p: ({ children, ...props }) => {
            return <p {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar, onPreview, seenDocIdsRef.current)}</p>;
          },
          td: ({ children, ...props }) => {
            return <td className="border-t border-border/50 px-3 py-2" {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar, onPreview, seenDocIdsRef.current)}</td>;
          },
          li: ({ children, ...props }) => {
            return <li className="my-0.5" {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar, onPreview, seenDocIdsRef.current)}</li>;
          },
          strong: ({ children, ...props }) => {
            return <strong {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar, onPreview, seenDocIdsRef.current)}</strong>;
          },
          ol: ({ children, ...props }) => {
            return <ol className="my-2 list-decimal pl-6" {...props}>{children}</ol>;
          },
          ul: ({ children, ...props }) => {
            return <ul className="my-2 list-disc pl-6" {...props}>{children}</ul>;
          },
          a: ({ children, href, ...props }) => {
            return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
          },
        }}
      >
        {processed}
      </Markdown>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Main chat component                                                */
/* ------------------------------------------------------------------ */
type AgentOption = {
  slug: string;
  name: string;
  icon: 'bot' | 'search';
  placeholder: string;
};

const AGENTS: AgentOption[] = [
  { slug: 'sales-assistant', name: 'Sales Assistant', icon: 'bot', placeholder: 'Ask the Sales Assistant about your pipeline, recent calls, or open deals…' },
  { slug: '__search__', name: 'Search Only', icon: 'search', placeholder: 'Search across your connected systems...' },
];

export const NewChatButton = () => {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
    >
      New Chat
    </button>
  );
};

export const AskChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeDocuments, setActiveDocuments] = useState<OnyxDocument[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentOption>(AGENTS[0]!);
  const isSearchOnly = selectedAgent.slug === '__search__';

  // Streaming state
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingSearchQueries, setStreamingSearchQueries] = useState<string[]>([]);
  const [streamingSearchDocs, setStreamingSearchDocs] = useState<OnyxDocument[]>([]);
  const [streamingPhase, setStreamingPhase] = useState<'idle' | 'thinking' | 'searching' | 'answering'>('idle');
  const [completedSteps, setCompletedSteps] = useState<ThinkingStep[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [highlightedSource, setHighlightedSource] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ doc: OnyxDocument; num?: string } | null>(null);
  const [pendingSkillResults, setPendingSkillResults] = useState<SkillResult[]>([]);
  const skillResultsRef = useRef<SkillResult[]>([]);
  const elapsed = useElapsed(thinking);

  const handleCitationClick = useCallback((n: number) => {
    // Scroll to and highlight the nth source in the drawer (1-indexed)
    setHighlightedSource(n);
    const el = document.querySelector(`[data-source-index="${n}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setHighlightedSource(null), 2000);
    }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) {
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setThinking(true);
    setStreamingAnswer('');
    setStreamingThinking('');
    setStreamingSearchQueries([]);
    setStreamingSearchDocs([]);
    setStreamingPhase('idle');
    setCompletedSteps([]);

    let currentThinking = '';
    let currentAnswer = '';
    let currentSearchQueries: string[] = [];
    let currentSearchDocs: OnyxDocument[] = [];
    let allDocs: OnyxDocument[] = [];
    let steps: ThinkingStep[] = [];
    let citationCount = 0;
    const startTime = Date.now();

    try {
      const res = await fetch('/rpc/onyx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, chat_session_id: sessionId }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errText}` }]);
        setLoading(false);
        setThinking(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          let packet: any;
          try {
            packet = JSON.parse(line);
          } catch {
            continue;
          }

          // Session ID (first packet)
          if (packet.chat_session_id && !packet.obj) {
            if (!sessionId) {
              setSessionId(packet.chat_session_id);
            }
            continue;
          }

          // Message metadata
          if (packet.user_message_id) {
            continue;
          }

          const obj = packet.obj || packet;
          if (!obj.type) {
            continue;
          }

          switch (obj.type) {
            case 'reasoning_start':
              setStreamingPhase('thinking');
              currentThinking = '';
              break;

            case 'reasoning_delta':
              currentThinking += obj.reasoning || '';
              setStreamingThinking(currentThinking);
              break;

            case 'reasoning_done':
              if (currentThinking.trim()) {
                steps = [...steps, { type: 'thinking', content: currentThinking }];
                setCompletedSteps([...steps]);
              }
              setStreamingPhase('idle');
              setStreamingThinking('');
              currentThinking = '';
              break;

            case 'search_tool_start':
              setStreamingPhase('searching');
              currentSearchQueries = [];
              currentSearchDocs = [];
              setStreamingSearchQueries([]);
              setStreamingSearchDocs([]);
              break;

            case 'search_tool_queries_delta':
              currentSearchQueries = obj.queries || [];
              setStreamingSearchQueries(currentSearchQueries);
              break;

            case 'search_tool_documents_delta': {
              const docs = (obj.documents || []).map((d: any) => ({
                document_id: d.document_id,
                semantic_identifier: d.semantic_identifier || d.document_id,
                link: d.link || '',
                source_type: d.source_type || 'unknown',
                blurb: d.blurb || '',
              }));
              currentSearchDocs = [...currentSearchDocs, ...docs];
              allDocs = [...allDocs, ...docs];
              setStreamingSearchDocs([...currentSearchDocs]);
              setActiveDocuments([...allDocs]);
              break;
            }

            case 'section_end':
              if (currentSearchQueries.length > 0 || currentSearchDocs.length > 0) {
                steps = [...steps, { type: 'search', content: '', queries: currentSearchQueries, documents: currentSearchDocs }];
                setCompletedSteps([...steps]);
              }
              setStreamingPhase('idle');
              setStreamingSearchQueries([]);
              setStreamingSearchDocs([]);
              break;

            case 'message_start':
              setStreamingPhase('answering');
              break;

            case 'message_delta':
              // Onyx uses "content" not "message"
              currentAnswer += obj.content || obj.message || '';
              setStreamingAnswer(currentAnswer);
              break;

            case 'citation_info':
              citationCount++;
              break;

            case 'stop':
              break;

            default:
              break;
          }
        }

        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }

      const thinkingSeconds = Math.round((Date.now() - startTime) / 1000);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: currentAnswer || 'No response received. The model may have timed out.',
        documents: allDocs,
        citationCount: citationCount || allDocs.length,
        thinkingSteps: steps,
        thinkingSeconds,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error: Could not connect to Vocion. Is Onyx running?',
      }]);
    } finally {
      setLoading(false);
      setThinking(false);
      setStreamingAnswer('');
      setStreamingThinking('');
      setStreamingPhase('idle');
      setCompletedSteps([]);
      setStreamingSearchQueries([]);
      setStreamingSearchDocs([]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [loading, sessionId]);

  // Agent mode: non-streaming, tool-calling agent endpoint
  const sendAgentMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) {
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    setThinking(true);
    setStreamingPhase('thinking');
    setStreamingThinking(`${selectedAgent.name} is thinking...`);
    setCompletedSteps([]);
    skillResultsRef.current = [];
    setPendingSkillResults([]);
    const startTime = Date.now();

    let steps: ThinkingStep[] = [];
    let finalResponse = '';
    let allDocs: OnyxDocument[] = [];
    setActiveDocuments([]);

    try {
      const res = await fetch('/rpc/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          agent_slug: selectedAgent.slug,
          stream: true,
          // Send recent conversation history so the agent has context
          conversation_history: messages.slice(-6).map(m => ({
            role: m.role,
            content: m.content.slice(0, 2000), // Truncate to keep payload reasonable
          })),
        }),
      });

      if (!res.ok || !res.body) {
        let errMsg = 'Agent request failed';
        try {
          const errData = await res.json();
          errMsg = errData.error ?? errMsg;
          if (errMsg.includes('Vespa') || errMsg.includes('503')) {
            errMsg = 'The search index is currently rebuilding. Please try again in a few minutes.';
          }
        } catch {
          errMsg = await res.text();
        }
        setMessages(prev => [...prev, { role: 'assistant', content: errMsg }]);
        setLoading(false);
        setThinking(false);
        setStreamingPhase('idle');
        setStreamingThinking('');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'thinking':
              setStreamingPhase('thinking');
              setStreamingThinking(`${selectedAgent.name} is reasoning...`);
              break;

            case 'tool_start': {
              const toolName = event.tool as string;
              const query = event.input?.query as string ?? '';
              if (toolName === 'search_onyx') {
                setStreamingPhase('searching');
                setStreamingThinking(`Searching for "${query}"`);
                setStreamingSearchQueries(prev => [...prev, query]);
                // Show the search query immediately as a live step
                steps = [...steps, { type: 'search', content: `Searching...`, queries: [query] }];
                setCompletedSteps([...steps]);
              } else if (toolName.startsWith('run_')) {
                const skillSlug = toolName.replace('run_', '');
                const skillName = skillSlug.replace(/_/g, ' ');
                setStreamingPhase('thinking');
                setStreamingThinking(`Running skill: ${skillName}`);
                steps = [...steps, { type: 'skill', content: 'Running...', queries: [skillName], skillSlug }];
                setCompletedSteps([...steps]);
              } else if (toolName === 'find_related_conversations') {
                const topic = event.input?.topic as string ?? '';
                setStreamingPhase('searching');
                setStreamingThinking(`Searching conversations for "${topic}"`);
                steps = [...steps, { type: 'search', content: 'Searching...', queries: [`Gmail, Slack, HubSpot: ${topic}`] }];
                setCompletedSteps([...steps]);
              } else if (toolName === 'search_everything') {
                const topic = event.input?.topic as string ?? '';
                setStreamingPhase('searching');
                setStreamingThinking(`Searching all sources for "${topic}"`);
                steps = [...steps, { type: 'search', content: 'Searching...', queries: [`All sources: ${topic}`] }];
                setCompletedSteps([...steps]);
              } else if (toolName === 'lookup_objects') {
                setStreamingPhase('searching');
                setStreamingThinking(`Looking up ${event.input?.type_slug ?? 'business objects'}...`);
              } else {
                setStreamingThinking(`Using tool: ${toolName}`);
              }
              break;
            }

            case 'tool_end': {
              const toolName = event.tool as string;
              const query = event.input?.query as string ?? '';
              const resultSummary = event.output ?? '';
              if (toolName === 'search_onyx' || toolName === 'find_related_conversations' || toolName === 'search_everything') {
                // Replace the last "Searching..." step with the result
                const lastSearchIdx = steps.findLastIndex(s => s.type === 'search' && s.content === 'Searching...');
                if (lastSearchIdx >= 0) {
                  const queryLabel = toolName === 'find_related_conversations'
                    ? `Gmail, Slack, HubSpot: ${event.input?.topic ?? query}`
                    : toolName === 'search_everything'
                      ? `All sources: ${event.input?.topic ?? query}`
                      : query;
                  steps[lastSearchIdx] = { type: 'search', content: resultSummary, queries: [queryLabel] };
                  steps = [...steps];
                } else {
                  steps = [...steps, { type: 'search', content: resultSummary, queries: [query] }];
                }
              } else if (toolName.startsWith('run_')) {
                const skillSlug = toolName.replace('run_', '');
                const skillName = skillSlug.replace(/_/g, ' ');
                // Update existing skill step instead of adding a new one
                const skillStepIdx = steps.findLastIndex(s => s.type === 'skill' && s.skillSlug === skillSlug);
                if (skillStepIdx >= 0) {
                  steps = [...steps];
                  steps[skillStepIdx] = { ...steps[skillStepIdx]!, content: resultSummary };
                } else {
                  steps = [...steps, { type: 'skill', content: resultSummary, queries: [skillName], skillSlug }];
                }
              } else if (toolName === 'lookup_objects') {
                steps = [...steps, { type: 'search', content: resultSummary, queries: [event.input?.type_slug as string ?? 'all'] }];
              }
              setCompletedSteps([...steps]);
              setStreamingPhase('thinking');
              setStreamingThinking(`${selectedAgent.name} is reasoning...`);
              break;
            }

            case 'documents': {
              const newDocs = (event.documents ?? []).map((d: any) => ({
                document_id: d.document_id ?? '',
                semantic_identifier: d.semantic_identifier ?? '',
                link: d.link ?? '',
                source_type: d.source_type ?? 'unknown',
                blurb: d.blurb ?? '',
                metadata: d.metadata ?? {},
                updated_at: d.updated_at ?? '',
              }));
              allDocs = [...allDocs, ...newDocs];
              setActiveDocuments([...allDocs]);
              // Attach docs to the most recent search step for "Reading" display
              const lastSearchIdx = steps.findLastIndex(s => s.type === 'search');
              if (lastSearchIdx >= 0) {
                steps[lastSearchIdx] = { ...steps[lastSearchIdx]!, documents: [...(steps[lastSearchIdx]!.documents ?? []), ...newDocs] };
                steps = [...steps];
                setCompletedSteps([...steps]);
              }
              break;
            }

            case 'skill_result': {
              if (event.skillResult) {
                skillResultsRef.current = [...skillResultsRef.current, event.skillResult!];
                setPendingSkillResults([...skillResultsRef.current]);
              }
              break;
            }

            case 'answering':
              setThinking(false);
              setStreamingPhase('answering');
              setStreamingThinking('');
              setStreamingAnswer('');
              break;

            case 'response_delta':
              finalResponse += event.delta ?? '';
              setStreamingAnswer(finalResponse);
              break;

            case 'done':
              if (!finalResponse && event.response) {
                finalResponse = event.response;
              }
              break;

            case 'error':
              finalResponse = `Error: ${event.output ?? 'Unknown error'}`;
              break;
          }
        }

        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }

      const thinkingSeconds = Math.round((Date.now() - startTime) / 1000);

      // Capture skill results from the ref (synchronous, unlike state)
      const capturedSkillResults = [...skillResultsRef.current];
      skillResultsRef.current = [];
      setPendingSkillResults([]);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: finalResponse || 'No response received.',
        documents: allDocs,
        citationCount: allDocs.length,
        thinkingSteps: steps,
        thinkingSeconds,
        skillResults: capturedSkillResults.length > 0 ? capturedSkillResults : undefined,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error: Could not connect to the agent endpoint.',
      }]);
    } finally {
      setLoading(false);
      setThinking(false);
      setStreamingAnswer('');
      setStreamingThinking('');
      setStreamingPhase('idle');
      setCompletedSteps([]);
    }
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSearchOnly) {
      sendMessage(input);
    } else {
      sendAgentMessage(input);
    }
  };

  const suggestions = messages.length === 0
    ? isSearchOnly
      ? [
          'What deals are in my HubSpot pipeline?',
          'Find recent proposals in Google Drive',
          'Do we have any recent discovery calls on Zoom?',
          'Summarize my latest client emails from Gmail',
        ]
      : [
          'What discovery calls did I have this week?',
          'Summarize my most recent discovery call transcript',
          'Draft a follow-up email from my latest discovery call',
          'What deals are in my pipeline?',
          'What are the key topics from recent prospect calls?',
        ]
    : [];

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
      {/* Conversation pane */}
      <div className="flex min-w-0 flex-1 flex-col rounded-md border border-border">
        <div className="flex-1 space-y-6 overflow-x-hidden overflow-y-auto p-4">
          {messages.length === 0 && !loading && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Bot className="size-12 stroke-muted-foreground/30" />
              <div className="mt-3 text-lg font-semibold">
                {isSearchOnly ? 'Search your business context' : `Talk to ${selectedAgent.name}`}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {isSearchOnly
                  ? 'Answers are grounded in your connected systems with source citations.'
                  : `${selectedAgent.name} can search, summarize transcripts, draft emails, and manage your sales pipeline.`}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => isSearchOnly ? sendMessage(s) : sendAgentMessage(s)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                {msg.role === 'user'
                  ? <User className="size-4 stroke-muted-foreground" />
                  : <Bot className="size-4 stroke-muted-foreground" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {msg.role === 'user' ? 'You' : selectedAgent.name}
                </div>
                {msg.role === 'assistant' && msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
                  <ThinkingPanel steps={msg.thinkingSteps} seconds={msg.thinkingSeconds} />
                )}
                {msg.role === 'assistant'
                  ? (
                      <>
                        <MarkdownContent content={msg.content} onCitationClick={handleCitationClick} documents={msg.documents} onAction={sendAgentMessage} onOpenSidebar={() => setShowSidebar(true)} onPreview={(d, n) => setPreviewDoc({ doc: d, num: n })} />
                        {/* Render skill results as structured cards */}
                        {msg.skillResults?.map(sr => (
                          <div key={sr.runId} className="mt-3">
                            {sr.skillSlug === 'draft_mvp_proposal'
                              ? (
                                  <ProposalCard
                                    skillName={sr.skillName}
                                    runId={sr.runId}
                                    content={sr.content}
                                    status={sr.status}
                                    prospectName={sr.prospectName}
                                    prospectCompany={sr.prospectCompany}
                                  />
                                )
                              : (
                                  <EmailDraftCard
                                    skillName={sr.skillName}
                                    runId={sr.runId}
                                    content={sr.content}
                                    status={sr.status}
                                    prospectName={sr.prospectName}
                                    prospectCompany={sr.prospectCompany}
                                  />
                                )}
                            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span>Rate this output:</span>
                              <FeedbackButtons runId={sr.runId} kind="skill" compact />
                            </div>
                          </div>
                        ))}
                      </>
                    )
                  : <div className="text-[15px] font-medium">{msg.content}</div>}
                {/* Suggested actions — context-aware buttons based on message content */}
                {msg.role === 'assistant' && msg.documents && msg.documents.length > 0 && (() => {
                  // Detect what kind of response this is and suggest relevant actions
                  const text = msg.content.toLowerCase();
                  const hasDiscovery = msg.documents.some(d => d.metadata?.call_type === 'discovery');
                  const hasZoom = msg.documents.some(d => d.source_type === 'zoom');
                  const prospectNames = msg.documents
                    .filter(d => d.metadata?.prospect_name)
                    .map(d => d.metadata!.prospect_name as string)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .slice(0, 3);
                  const isSummary = text.includes('summary') || text.includes('prospect:') || text.includes('next steps');
                  const hasSkillResults = msg.skillResults && msg.skillResults.length > 0;
                  const isEmailDraft = hasSkillResults && msg.skillResults!.some(sr => sr.skillSlug !== 'draft_mvp_proposal');
                  const isProposal = hasSkillResults && msg.skillResults!.some(sr => sr.skillSlug === 'draft_mvp_proposal');

                  const actions: Array<{ label: string; icon: React.ReactNode; message: string }> = [];

                  if (hasDiscovery && !isSummary && !hasSkillResults) {
                    // After listing discovery calls → offer to summarize
                    if (prospectNames.length === 1) {
                      actions.push({ label: `Summarize ${prospectNames[0]} call`, icon: <Sparkles className="size-3" />, message: `Summarize the "${prospectNames[0]}" discovery call` });
                    } else {
                      actions.push({ label: 'Summarize a call', icon: <Sparkles className="size-3" />, message: 'Summarize the most recent discovery call in detail' });
                    }
                  }

                  if (hasZoom && isSummary && !hasSkillResults) {
                    // After summarizing a call → offer to draft email, proposal, and find related
                    const name = prospectNames[0] ?? 'this prospect';
                    actions.push({ label: `Draft follow-up email`, icon: <Copy className="size-3" />, message: `Draft a follow-up email for the "${name}" call` });
                    actions.push({ label: 'Generate proposal', icon: <Sparkles className="size-3" />, message: `Generate an MVP proposal for the "${name}" call` });
                    actions.push({ label: 'Find related conversations', icon: <Search className="size-3" />, message: `Find related conversations for "${name}" — search Gmail, Slack, and HubSpot` });
                  }

                  if (isEmailDraft) {
                    // After email draft → offer alternatives
                    actions.push({ label: 'Make it shorter', icon: <Sparkles className="size-3" />, message: 'Make the email shorter and more casual' });
                    actions.push({ label: 'More sales-forward', icon: <Sparkles className="size-3" />, message: 'Make the email more sales-forward with a stronger CTA' });
                  }

                  if (isProposal) {
                    // After proposal → offer refinement and next steps
                    const name = prospectNames[0] ?? 'this prospect';
                    actions.push({ label: 'Tighten language', icon: <Sparkles className="size-3" />, message: 'Tighten the proposal language — more executive, less wordy' });
                    actions.push({ label: 'Draft follow-up email', icon: <Copy className="size-3" />, message: `Draft a follow-up email for "${name}" that sends the proposal and frames next steps` });
                  }

                  if (!hasDiscovery && hasZoom) {
                    actions.push({ label: 'Find related emails', icon: <Search className="size-3" />, message: 'Search Gmail and HubSpot for related conversations' });
                  }

                  if (actions.length === 0) {
                    return null;
                  }

                  return (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {actions.map(a => (
                        <button
                          key={a.label}
                          type="button"
                          onClick={() => sendAgentMessage(a.message)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                        >
                          {a.icon}
                          {a.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
                {msg.role === 'assistant' && (
                  <div className="mt-4 flex items-center gap-1 border-t border-border/30 pt-3">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Copy response"
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button type="button" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Good response">
                      <ThumbsUp className="size-3.5" />
                    </button>
                    <button type="button" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Bad response">
                      <ThumbsDown className="size-3.5" />
                    </button>
                    <button type="button" className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Regenerate">
                      <RefreshCw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSidebar(!showSidebar)}
                      className="ml-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Search className="size-3" />
                      {msg.citationCount && msg.citationCount > 0
                        ? `${msg.citationCount} sources`
                        : 'Sources'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Streaming state */}
          {loading && (
            <div className="flex gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="size-4 stroke-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs font-medium text-muted-foreground">{selectedAgent.name}</div>

                <LiveThinking
                  steps={completedSteps}
                  phase={streamingPhase}
                  thinkingText={streamingThinking}
                  searchQueries={streamingSearchQueries}
                  searchDocs={streamingSearchDocs}
                  elapsed={elapsed}
                />

                {streamingPhase === 'answering' && streamingAnswer && (
                  <MarkdownContent content={streamingAnswer} onCitationClick={handleCitationClick} documents={activeDocuments} onAction={sendAgentMessage} onOpenSidebar={() => setShowSidebar(true)} onPreview={(d, n) => setPreviewDoc({ doc: d, num: n })} />
                )}

                {/* Show skill results as they arrive during streaming */}
                {pendingSkillResults.map(sr => (
                  <div key={sr.runId} className="mt-3">
                    {sr.skillSlug === 'draft_mvp_proposal'
                      ? (
                          <ProposalCard
                            skillName={sr.skillName}
                            runId={sr.runId}
                            content={sr.content}
                            status={sr.status}
                            prospectName={sr.prospectName}
                            prospectCompany={sr.prospectCompany}
                          />
                        )
                      : (
                          <EmailDraftCard
                            skillName={sr.skillName}
                            runId={sr.runId}
                            content={sr.content}
                            status={sr.status}
                            prospectName={sr.prospectName}
                            prospectCompany={sr.prospectCompany}
                          />
                        )}
                    <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>Rate this output:</span>
                      <FeedbackButtons runId={sr.runId} kind="skill" compact />
                    </div>
                  </div>
                ))}

                {streamingPhase === 'idle' && !streamingAnswer && completedSteps.length === 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <Loader2 className="size-3 animate-spin stroke-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Connecting...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="border-t border-border p-4">
          <div className="mb-2 flex items-center gap-2">
            {AGENTS.map(agent => (
              <button
                key={agent.slug}
                type="button"
                onClick={() => setSelectedAgent(agent)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${selectedAgent.slug === agent.slug ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {agent.icon === 'bot' ? <Bot className="size-3" /> : <Search className="size-3" />}
                {agent.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={selectedAgent.placeholder}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="shrink-0 rounded-md bg-primary p-1.5 disabled:opacity-50"
            >
              <Send className="size-3.5 stroke-primary-foreground" />
            </button>
          </div>
        </form>
      </div>

      {/* Context drawer — Onyx-style source cards, hidden by default */}
      <div className={`w-80 shrink-0 rounded-md border border-border transition-all ${showSidebar ? 'hidden lg:block' : 'hidden'}`}>
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Search className="size-3.5" />
              Cited Sources
            </div>
            <button
              type="button"
              onClick={() => setShowSidebar(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
          <div className="text-xs text-muted-foreground">
            {activeDocuments.length}
            {' '}
            sources referenced
          </div>
        </div>
        <div className="max-h-[calc(100vh-20rem)] space-y-1.5 overflow-y-auto p-2">
          {activeDocuments.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No sources found for this query. Try a different search or check that connectors are indexed.
            </div>
          )}
          {activeDocuments.map((doc, i) => {
            const color = sourceColors[doc.source_type] ?? '#888';
            const label = sourceLabels[doc.source_type] ?? doc.source_type;
            const isHighlighted = highlightedSource === i + 1;
            const title = getDisplayTitle(doc);
            const blurb = getCleanBlurb(doc.blurb ?? '');
            return (
              <button
                type="button"
                key={`${doc.document_id}-${i}`}
                data-source-index={i + 1}
                onClick={() => setPreviewDoc({ doc, num: String(i + 1) })}
                className={`block w-full cursor-pointer rounded-lg border p-3 text-left transition-all hover:shadow-sm ${isHighlighted ? 'border-primary/30 bg-primary/5 ring-2 ring-primary/50' : 'border-border hover:border-border/80 hover:bg-muted/30'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white" style={{ backgroundColor: color }}>
                    {i + 1}
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${color}15`, color }}>
                    {label}
                  </span>
                </div>
                <div className="mt-1.5 text-sm leading-snug font-medium">{title}</div>
                {/* Metadata line: date, duration, call_type */}
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  {doc.updated_at && (() => {
                    try {
                      return <span>{new Date(doc.updated_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>;
                    } catch {
                      return null;
                    }
                  })()}
                  {doc.metadata?.duration_minutes
                    ? (
                        <span>
                          {doc.metadata.duration_minutes}
                          {' '}
                          min
                        </span>
                      )
                    : null}
                  {doc.metadata?.host ? <span>{doc.metadata.host}</span> : null}
                  {doc.metadata?.call_type
                    ? <span className="rounded bg-primary/10 px-1 font-medium text-primary">{doc.metadata.call_type}</span>
                    : null}
                </div>
                {blurb && (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {blurb}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Document preview modal */}
      {previewDoc && (
        <DocumentPreview
          doc={previewDoc.doc}
          num={previewDoc.num}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
};
