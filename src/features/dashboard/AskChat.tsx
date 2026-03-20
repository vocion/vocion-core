'use client';

import { Bot, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, Search, Send, ThumbsDown, ThumbsUp, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { ApprovalCard } from '@/features/dashboard/ApprovalCard';
import { ContextMenu } from '@/features/dashboard/ContextMenu';

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
  type: 'thinking' | 'search';
  content: string;
  documents?: OnyxDocument[];
  queries?: string[];
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  documents?: OnyxDocument[];
  citationCount?: number;
  thinkingSteps?: ThinkingStep[];
  thinkingSeconds?: number;
};

/* ------------------------------------------------------------------ */
/* Elapsed timer hook                                                 */
/* ------------------------------------------------------------------ */
const useElapsed = (running: boolean) => {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setSeconds(0);
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
  const isActive = phase === 'thinking' || phase === 'searching';
  if (!isActive && steps.length === 0) {
    return null;
  }
  if (phase === 'answering') {
    // Collapse once answer starts
    return steps.length > 0 ? <ThinkingPanel steps={steps} seconds={elapsed} /> : null;
  }

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span className="font-medium">
          Reading
          {elapsed > 0 ? ` ${elapsed}s` : ''}
        </span>
        {steps.length > 0 && (
          <span className="text-muted-foreground/60">
            {steps.length + (isActive ? 1 : 0)}
            {' '}
            steps
          </span>
        )}
      </div>

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
    </div>
  );
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
/* Citation badge with hover popover                                   */
/* ------------------------------------------------------------------ */
const CitationBadge = ({ num, sourceType, document: doc, onOpenSidebar }: {
  num: string;
  onClick?: () => void;
  sourceType?: string;
  document?: OnyxDocument;
  onOpenSidebar?: () => void;
}) => {
  const [showPopover, setShowPopover] = useState(false);
  const color = sourceType ? sourceColors[sourceType] : undefined;
  const label = sourceType ? (sourceLabels[sourceType] ?? sourceType.replace('_', ' ')) : null;
  const link = doc?.link;

  const handleClick = (e: React.MouseEvent) => {
    if (link) {
      // Let the link open naturally
    } else {
      e.preventDefault();
      onOpenSidebar?.();
    }
    // Always open sidebar on click
    onOpenSidebar?.();
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
    >
      {label && color
        ? (
            <a
              href={link || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="mx-0.5 inline-flex h-5 items-center gap-1 rounded px-1.5 align-middle text-[11px] font-medium no-underline transition-opacity hover:opacity-80"
              style={{ backgroundColor: `${color}18`, color }}
              onClick={handleClick}
            >
              {label}
            </a>
          )
        : (
            <button
              type="button"
              onClick={() => {
                // Open thinking panel and highlight the referenced step
                const panel = document.querySelector('[data-thinking-panel]');
                if (panel) {
                  // Click to open if closed
                  const toggle = panel.querySelector('button');
                  const isOpen = panel.querySelector('[data-thinking-steps]');
                  if (!isOpen && toggle) toggle.click();
                  // Highlight the step
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
          )}
      {/* Hover popover — shows below to avoid clipping at top */}
      {showPopover && doc && (
        <div className="absolute top-full left-0 z-[100] mt-1.5 w-72 rounded-lg border border-border bg-popover p-3 shadow-lg">
          <div className="flex items-center gap-2">
            {color && (
              <span
                className="flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                style={{ backgroundColor: color }}
              >
                {(sourceLabels[sourceType!] ?? sourceType!)[0]?.toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1 truncate text-sm font-medium">{doc.semantic_identifier}</div>
          </div>
          {doc.blurb && (
            <div className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {doc.blurb}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{label}</span>
            <span>
              #
              {num}
            </span>
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
): React.ReactNode {
  if (!children) {
    return children;
  }

  // Process arrays of children
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{renderWithCitations(child, onCitationClick, documents, onAction, onOpenSidebar)}</span>
    ));
  }

  // Only process string children
  if (typeof children !== 'string') {
    return children;
  }

  // Combined regex for both citations and business object markers
  const COMBINED = /\u200Bcite:(\d+)\u200B|\u200Bobj:(discovery|deal|account):([^:]*):([^\u200B]*)\u200B/g;

  if (!COMBINED.test(children)) {
    return children;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  const regex = new RegExp(COMBINED.source, 'g');

  while ((match = regex.exec(children)) !== null) {
    if (match.index > lastIndex) {
      parts.push(children.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Citation marker: cite:N
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
        />,
      );
    } else if (match[2]) {
      // Business object marker: obj:type:name:id
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
  }

  if (lastIndex < children.length) {
    parts.push(children.slice(lastIndex));
  }

  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/* Markdown renderer                                                  */
/* ------------------------------------------------------------------ */
const MarkdownContent = ({ content, onCitationClick, documents, onAction, onOpenSidebar }: { content: string; onCitationClick?: (n: number) => void; documents?: OnyxDocument[]; onAction?: (msg: string) => void; onOpenSidebar?: () => void }) => {
  // Convert citation markers to a safe unicode format that survives markdown parsing
  // Handles: <cite>N</cite>, [[N]](url), [N] (standalone number in brackets)
  // Also convert <<discovery:Name|id>> business object markers
  const processed = content
    .replace(/<cite>(\d+)<\/cite>/g, '\u200Bcite:$1\u200B')
    .replace(/\[\[(\d+)\]\]\([^)]*\)/g, '\u200Bcite:$1\u200B')
    .replace(/(?<!\[)(?<!\()\[(\d{1,2})\](?!\()/g, '\u200Bcite:$1\u200B')
    .replace(/<<(discovery|deal|account):([^|>]+?)(?:\|([^>]+?))?>>​?/g, '\u200Bobj:$1:$2:$3\u200B');

  return (
    <div className="prose dark:prose-invert prose-p:my-2 prose-headings:mb-2 prose-headings:mt-5 prose-headings:font-semibold prose-headings:text-base prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-a:text-primary prose-strong:font-semibold prose-strong:text-foreground prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:before:content-none prose-code:after:content-none max-w-none overflow-hidden text-[15px] leading-relaxed" style={{ overflowWrap: 'anywhere' }}>
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
            return <p {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar)}</p>;
          },
          td: ({ children, ...props }) => {
            return <td className="border-t border-border/50 px-3 py-2" {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar)}</td>;
          },
          li: ({ children, ...props }) => {
            return <li className="my-0.5" {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar)}</li>;
          },
          strong: ({ children, ...props }) => {
            return <strong {...props}>{renderWithCitations(children, onCitationClick, documents, onAction, onOpenSidebar)}</strong>;
          },
          ol: ({ children, ...props }) => {
            return <ol className="my-2 list-decimal pl-6" {...props}>{children}</ol>;
          },
          ul: ({ children, ...props }) => {
            return <ul className="my-2 list-disc pl-6" {...props}>{children}</ul>;
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
  { slug: 'ziggy', name: 'Ziggy', icon: 'bot', placeholder: 'Ask Ziggy anything about your sales pipeline...' },
  { slug: '__search__', name: 'Search Only', icon: 'search', placeholder: 'Search across your connected systems...' },
];

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
        content: 'Error: Could not connect to CoreContext. Is Onyx running?',
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
    const startTime = Date.now();

    let steps: ThinkingStep[] = [];
    let finalResponse = '';
    let allDocs: OnyxDocument[] = [];
    setActiveDocuments([]);

    try {
      const res = await fetch('/rpc/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, agent_slug: selectedAgent.slug, stream: true }),
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
                const skillName = toolName.replace('run_', '').replace(/_/g, ' ');
                setStreamingPhase('thinking');
                setStreamingThinking(`Running skill: ${skillName}`);
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
              if (toolName === 'search_onyx') {
                // Replace the last "Searching..." step with the result
                const lastSearchIdx = steps.findLastIndex(s => s.type === 'search' && s.content === 'Searching...');
                if (lastSearchIdx >= 0) {
                  steps[lastSearchIdx] = { type: 'search', content: resultSummary, queries: [query] };
                  steps = [...steps];
                } else {
                  steps = [...steps, { type: 'search', content: resultSummary, queries: [query] }];
                }
              } else if (toolName.startsWith('run_')) {
                const skillName = toolName.replace('run_', '').replace(/_/g, ' ');
                steps = [...steps, { type: 'thinking', content: `Skill: ${skillName} — ${resultSummary}` }];
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

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: finalResponse || 'No response received.',
        documents: allDocs,
        citationCount: allDocs.length,
        thinkingSteps: steps,
        thinkingSeconds,
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
                  ? (() => {
                      // Detect skill output that needs approval
                      const approvalMatch = msg.content.match(/\[Skill: (.+?) \| Run #(\d+) \| Status: PENDING APPROVAL\]\s*\n\n([\s\S]+)/);
                      if (approvalMatch) {
                        const preText = msg.content.slice(0, msg.content.indexOf('[Skill:'));
                        return (
                          <>
                            {preText.trim() && <MarkdownContent content={preText} onCitationClick={handleCitationClick} documents={msg.documents} onAction={sendAgentMessage} onOpenSidebar={() => setShowSidebar(true)} />}
                            <div className="mt-3">
                              <ApprovalCard
                                title={`Draft: ${approvalMatch[1]}`}
                                skillName={approvalMatch[1]!}
                                runId={Number(approvalMatch[2])}
                                content={approvalMatch[3]!}
                                status="pending"
                              />
                            </div>
                          </>
                        );
                      }
                      return <MarkdownContent content={msg.content} onCitationClick={handleCitationClick} documents={msg.documents} onAction={sendAgentMessage} onOpenSidebar={() => setShowSidebar(true)} />;
                    })()
                  : <div className="text-[15px] font-medium">{msg.content}</div>}
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
                  <MarkdownContent content={streamingAnswer} onCitationClick={handleCitationClick} documents={activeDocuments} onAction={sendAgentMessage} onOpenSidebar={() => setShowSidebar(true)} />
                )}

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
            return (
              <a
                key={doc.document_id || i}
                href={doc.link || '#'}
                target="_blank"
                rel="noopener noreferrer"
                data-source-index={i + 1}
                className={`block cursor-pointer rounded-lg border p-3 transition-all hover:shadow-sm ${isHighlighted ? 'border-primary/30 bg-primary/5 ring-2 ring-primary/50' : 'border-border hover:border-border/80 hover:bg-muted/30'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white" style={{ backgroundColor: color }}>
                    {i + 1}
                  </span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${color}15`, color }}>
                    {label}
                  </span>
                </div>
                <div className="mt-1.5 text-sm leading-snug font-medium">{doc.semantic_identifier}</div>
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
                    ? (
                        <span className="rounded bg-primary/10 px-1 font-medium text-primary">{doc.metadata.call_type}</span>
                      )
                    : null}
                </div>
                {doc.blurb && (
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {doc.blurb}
                  </div>
                )}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
};
