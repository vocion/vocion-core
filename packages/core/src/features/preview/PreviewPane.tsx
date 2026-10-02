'use client';

import type { PreviewFailure } from './previewFetch';
import type { PreviewDoc } from '@/libs/preview/types';
import type { RunStep } from '@/libs/worker/runLog';
import type { RecordRef, RecordType } from '@/services/chat/pageContext';
import { ArrowLeft, Bot, ExternalLink, FileText, History, Inbox, ListTree, MessageSquareText, Newspaper, Play, Rocket, RotateCw, SquareArrowOutUpRight, Target, User, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Accordion } from '@/components/patterns';
import { PanelCloseButton } from '@/components/ui/panel-close-button';
import { ARTIFACT_KIND_ICON } from '@/features/dashboard/artifacts/kinds';
import { SharePicker } from '@/features/dashboard/artifacts/SharePicker';
import { requestAgentSurface, stashChatAbout } from '@/features/dashboard/chat/agentSurface';
import { FeatureTimeline } from '@/features/dashboard/factory/FeatureTimeline';
import { RunStepList } from '@/features/dashboard/factory/RunDetail';
import { RunGlanceView } from '@/features/dashboard/factory/RunGlanceView';
import { LiveWorkStatus } from '@/features/dashboard/factory/WorkStatus';
import { RecordHistory } from '@/features/dashboard/objects/RecordHistory';
import { useVersionRefresh } from '@/features/dashboard/versions/VersionWatch';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { describeRef } from '@/libs/preview/describeRef';
import { useLiveSources } from '@/libs/preview/liveSources';
import { parseSourcesRefId, sourcesMarkdown } from '@/libs/preview/sourcesRef';
import { parsePreviewKey, PREVIEW_PARAM, previewKey } from '@/libs/preview/types';
import { parseHistoryRefId } from '@/libs/versions/versionRef';
import { RECORD_TYPES } from '@/services/chat/pageContext';
import { classifyPreviewError, FAILURE_REASON, RETRY_DELAYS_MS } from './previewFetch';
import { closePreview, openPreview } from './previewState';

/**
 * The preview PANE — the content, with no geometry of its own.
 *
 * Geometry belongs to the column (`features/dashboard/chat/RailColumn`), which
 * is the only thing that knows whether it is sharing the column with chat,
 * how tall each pane is, and whether it is a sheet on a small screen. This
 * file is the anatomy and nothing else:
 *
 *   header   the source chip and the link out
 *   body     what we hold
 *
 * A preview never carries actions that belong to the detail page — it answers
 * "is this the right thing, and what does it say", and the link is how you
 * make it the task.
 *
 * It renders no `Section`, deliberately. `Section` is a commentable region
 * (`patterns/DetailPage`), and a comment anchored in a peek would be filed
 * against the page you are standing on rather than the record you are
 * reading — so a selection inside a preview raises nothing, and the way to
 * talk about what you found is the link out.
 *
 * It never takes focus, which is what separates a peek from a dialog: Escape
 * closes it and hands focus back to whatever opened it, and the page's own
 * shortcuts keep working while it is open.
 */

const RECORD_ICON: Partial<Record<RecordType, typeof FileText>> = {
  briefing: Newspaper,
  ask: Inbox,
  agent: Bot,
  team: Users,
  mission: Target,
  mission_run: Rocket,
  worker_run: Play,
  lead: User,
  conversation: MessageSquareText,
  record_history: History,
  feature_section: ListTree,
};

/**
 * The kind's icon for an artifact, the record type's otherwise — inline before the title, in place of a chip.
 * @param ref
 * @param doc
 */
/**
 * The kind's icon for an artifact, the record type's otherwise — inline before
 * the title, in place of a chip. The source's name stays for a screen reader.
 * @param props
 * @param props.type - The record type.
 * @param props.doc - The resolved preview.
 */
function PreviewIcon({ type, doc }: { type: RecordType; doc: PreviewDoc }) {
  const Icon = type === 'artifact' && doc.kind && doc.kind in ARTIFACT_KIND_ICON
    ? ARTIFACT_KIND_ICON[doc.kind as keyof typeof ARTIFACT_KIND_ICON]
    : (RECORD_ICON[type] ?? FileText);
  return (
    <>
      <Icon className="mr-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{doc.sourceLabel}</span>
    </>
  );
}

/**
 * A link inside a preview's body. One written as `?preview=<type>:<id>` is a
 * peek at another record: it swaps this pane for that one in place — same
 * pane, pushed to history so Back returns — rather than reloading the page
 * (a feature's Timeline lists runs and conversations this way).
 * Everything else is an ordinary link.
 * @param props - The anchor's props from the markdown renderer.
 * @param props.href - Where it points.
 * @param props.children - The link text.
 */
function PeekLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const peek = href?.startsWith(`?${PREVIEW_PARAM}=`) ? parsePreviewKey(decodeURIComponent(href.slice(PREVIEW_PARAM.length + 2)), isRecordType) : null;
  if (peek) {
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          openPreview(peek, e.currentTarget);
        }}
        data-testid="preview-peek-link"
      >
        {children}
      </a>
    );
  }
  // An in-app page keeps the workspace in the URL, like every other link.
  if (href?.startsWith('/') && !href.startsWith('//')) {
    return <Link href={href}>{children}</Link>;
  }
  const external = href !== undefined && /^https?:\/\//i.test(href);
  return <a href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}

function Md({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <Markdown remarkPlugins={[remarkGfm]} components={{ a: PeekLink }}>{text}</Markdown>
    </div>
  );
}

/**
 * A run's steps in the run page's own shape, collapsed except a failed one —
 * a peek says how it went; the step that went wrong is the one worth opening.
 * @param props
 * @param props.steps - The steps.
 */
function Steps({ steps }: { steps: RunStep[] }) {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const failed = steps.find(s => s.status === 'failed')?.key;
  const open = steps.filter(s => chosen[s.key] ?? s.key === failed).map(s => s.key);
  const [now] = useState(() => Date.now());
  return (
    <div className="mt-4 border-t border-rule pt-3" data-testid="preview-steps">
      <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Steps</p>
      <RunStepList steps={steps} open={open} onToggle={(id, next) => setChosen(c => ({ ...c, [id]: next }))} now={now} />
    </div>
  );
}

/**
 * What is kept and not led with — a run's brief — each a collapsed row, last.
 * @param props
 * @param props.items - The rows.
 */
function More({ items }: { items: NonNullable<PreviewDoc['more']> }) {
  const [open, setOpen] = useState<string[]>([]);
  return (
    <Accordion
      className="mt-4 border-t border-rule pt-1"
      items={items.map(m => ({ id: m.key, title: m.title, children: <Md text={m.body} /> }))}
      open={open}
      onToggle={(id, next) => setOpen(o => (next ? [...o, id] : o.filter(k => k !== id)))}
    />
  );
}

/**
 * The server is restarting: say so, keep trying, and offer to try now.
 * @param props
 * @param props.retrying - Whether another automatic try is scheduled.
 * @param props.onRetry - Try now.
 */
function Restarting({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div className="px-4 py-3" data-testid="preview-restarting" role="status">
      <p className="text-sm text-foreground">{retrying ? 'Vocion is restarting — retrying…' : 'Vocion is still restarting.'}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{retrying ? 'This happens during an update and takes a few seconds.' : 'It has not come back yet. Try again in a moment.'}</p>
      <button type="button" onClick={onRetry} data-testid="preview-retry" className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] text-foreground transition-colors hover:bg-surface-hover">
        <RotateCw className="size-3.5" aria-hidden />
        Retry
      </button>
    </div>
  );
}

/**
 * A reference that cannot be read: what it is, in words, why, and its page.
 * @param props
 * @param props.label - What the reference is ("Agent run #5974").
 * @param props.reason - Why it could not be read.
 * @param props.href - Its full page, when there is one.
 * @param props.reference - The raw reference, shown only when there is no page to open.
 */
function CouldNotLoad({ label, reason, href, reference }: { label: string; reason: string; href?: string; reference?: string }) {
  return (
    <div className="px-4 py-3" data-testid="preview-unresolved">
      <p className="text-sm text-foreground">{`Could not load ${label}.`}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{reason}</p>
      {href
        ? <Link href={href} className="mt-3 inline-block text-[13px] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground" data-testid="preview-unresolved-link">{`Open ${label}`}</Link>
        : reference && reference !== label && (
          <>
            <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reference</p>
            <p className="mt-1 font-mono text-[12px] break-all text-foreground">{reference}</p>
          </>
        )}
    </div>
  );
}

function isRecordType(s: string): s is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(s);
}

function Body(props: { doc: PreviewDoc }) {
  const { doc } = props;
  // A record's history draws as itself — diffs and Restore — because its
  // whole point is the version you pick; the markdown body is the same
  // history as text for surfaces that render a doc plainly.
  const history = doc.kind === 'record_history' && !doc.unresolved ? parseHistoryRefId(doc.ref.id) : null;
  if (history) {
    return <RecordHistory objectId={history.objectId} focusVersion={history.version} />;
  }
  if (doc.unresolved) {
    return <CouldNotLoad label={doc.title} reason={doc.unresolved.reason} href={doc.href} reference={doc.unresolved.reference} />;
  }
  // A feature's Timeline draws as its page draws it, every row (one list,
  // two densities — `FeatureTimeline`).
  if (doc.timeline) {
    return (
      <div className="px-4 py-3">
        <FeatureTimeline rows={doc.timeline.rows} cost={doc.timeline.cost} density="full" />
      </div>
    );
  }
  // An engineering run draws as its run page does: one header, one shape.
  if (doc.run) {
    return (
      <div className="px-4 py-3">
        <RunGlanceView key={doc.run.header.ref} initial={doc.run} />
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      {/* WHERE IT IS, first: the same You / Now / Next as its page, kept
          current while something runs (`WorkStatus`). */}
      {doc.status && <LiveWorkStatus key={doc.status.record.id} recordId={doc.status.record.id} initial={doc.status} className="mb-4 border-b border-border/60 pb-3" />}
      {doc.subtitle && <p className="mb-3 text-sm leading-relaxed text-foreground">{doc.subtitle}</p>}
      {doc.facts && doc.facts.length > 0 && (
        // One muted line by default; the kind, version and dates are a
        // glance away, not a block above the words.
        <details className="mb-3 text-[12px]">
          <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">{doc.facts.map(f => f.value).slice(0, 3).join(' · ')}</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {doc.facts.map(f => (
              <div key={f.label} className="contents">
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="min-w-0 break-words text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {doc.body
        ? <div className="border-t border-rule pt-3"><Md text={doc.body} /></div>
        : !doc.steps?.length && !doc.more?.length && <p className="border-t border-rule pt-3 text-sm text-muted-foreground">No text was synced for this reference.</p>}
      {doc.truncated && <p className="mt-3 text-xs text-muted-foreground">Cut short — open the full page for the rest.</p>}
      {doc.href && doc.hrefLabel && (
        <Link href={doc.href} data-testid="preview-open-record" className="mt-3 inline-block text-[13px] text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">{doc.hrefLabel}</Link>
      )}
      {doc.steps && doc.steps.length > 0 && <Steps steps={doc.steps} />}
      {doc.more && doc.more.length > 0 && <More items={doc.more} />}
    </div>
  );
}

/**
 * @param props
 * @param props.recordRef - What to show.
 * @param props.back - On a small screen the column is a sheet, so the preview
 * replaces its content rather than splitting it in two; the close control
 * becomes "back to chat" and says so. An in-page pane that swaps a list for a
 * preview uses it for the same reason.
 * @param props.doc - An already-resolved preview. A surface that assembled the
 * content on the server (the review sheet's context pane) hands it in rather
 * than paying for a round trip to fetch what the page already holds; the RPC
 * is skipped entirely.
 * @param props.onClose - What the close/back control does. Defaults to closing
 * the global `?preview=` peek, which is right for the rail and wrong for a
 * pane whose selection is its own local state.
 * @param props.backLabel - What the back control promises, when `back` is set.
 * Defaults to "Back to chat", which is what the rail's sheet goes back to; an
 * in-page pane names its own list instead.
 * @param props.compact - Drop the controls that do not fit a narrow in-page
 * column: Share, and "Chat about this" (which would take the reader off the
 * decision they are standing on). The link out always stays.
 */
export function PreviewPane(props: { recordRef: Pick<RecordRef, 'type' | 'id'>; back?: boolean; backLabel?: string; doc?: PreviewDoc; onClose?: () => void; compact?: boolean }) {
  const { recordRef } = props;
  const [fetched, setFetched] = useState<PreviewDoc | null>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  // Which try this is (0 = the first), and a bump for a person's Retry.
  const [attempt, setAttempt] = useState(0);
  const [round, setRound] = useState(0);
  // A caller that already holds the content wins outright: there is nothing to
  // fetch and nothing to wait for.
  // A turn still streaming has no stored sources yet: the rail's live ones
  // stand in, until the answer is saved and the ref names it (`liveSources.ts`).
  const sourcesId = recordRef.type === 'conversation' ? parseSourcesRefId(recordRef.id) : null;
  const liveSources = useLiveSources(sourcesId && sourcesId.messageId === null ? sourcesId.conversationId : null);
  const liveDoc = useMemo<PreviewDoc | undefined>(() => (liveSources && liveSources.length > 0
    ? { ref: recordRef as RecordRef, title: `Sources · ${liveSources.length}`, sourceLabel: 'Sources', subtitle: 'This answer is still being written; its sources so far.', body: sourcesMarkdown(liveSources) }
    : undefined), [liveSources, recordRef]);
  const given = props.doc ?? liveDoc;
  const doc = given ?? fetched;
  const named = describeRef(recordRef);

  // The pane is keyed on the ref by its parent, so a new reference remounts it
  // and the loading state is the initial state — no reset needed here.
  //
  // A failure while the server restarts is not an answer: it is retried with
  // backoff and said as "restarting". Only the server saying the reference is
  // missing or not yours ends the pane in "Could not load" (`previewFetch.ts`).
  useEffect(() => {
    if (given) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const transient = () => {
      setFailure('restarting');
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay !== undefined) {
        timer = setTimeout(() => {
          if (live) {
            setAttempt(a => a + 1);
          }
        }, delay);
      }
    };
    client.preview.get({ type: recordRef.type, id: recordRef.id })
      .then((d) => {
        if (!live) {
          return;
        }
        const read = d as PreviewDoc;
        if (read.unresolved?.retryable) {
          transient();
          return;
        }
        setFailure(null);
        setFetched(read);
      })
      .catch((error: unknown) => {
        if (!live) {
          return;
        }
        const kind = classifyPreviewError(error);
        if (kind === 'restarting') {
          transient();
        } else {
          setFailure(kind);
        }
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [recordRef.type, recordRef.id, given, attempt, round]);

  const retryNow = () => {
    setAttempt(0);
    setRound(r => r + 1);
  };

  // A new version of what this pane shows — written from chat or on the
  // page — refetches it in place (the doc stays on screen until the new one
  // lands, so nothing flashes) and marks what changed (backlog 035). A
  // history draws itself and listens on its own.
  useVersionRefresh({
    refs: given || recordRef.type === 'record_history' ? [] : [recordRef],
    root: () => (typeof document === 'undefined' ? null : document.querySelector(`[data-preview-key="${CSS.escape(`${recordRef.type}:${recordRef.id}`)}"]`)),
    refetch: () => setRound(r => r + 1),
    settled: fetched,
    ready: true,
  });
  const restarting = !doc && failure === 'restarting';
  const retrying = restarting && attempt < RETRY_DELAYS_MS.length;

  const shown: PreviewDoc = doc ?? {
    ref: { type: recordRef.type, id: recordRef.id },
    // What it is, in words, from the ref alone — never "5974" or "126.plan".
    title: named.label,
    sourceLabel: 'Preview',
    ...(named.href ? { href: named.href } : {}),
    ...(failure && failure !== 'restarting' ? { unresolved: { reason: FAILURE_REASON[failure], reference: recordRef.id } } : {}),
  };

  const router = useRouter();
  const record: RecordRef = { type: recordRef.type, id: recordRef.id, label: shown.title, ...(shown.href ? { href: shown.href } : {}) };
  // "Chat about this" opens a FRESH thread carrying this record as its
  // "About:" chip, and keeps the preview open beside it. A mounted rail
  // claims the request and starts over in place; with no rail, the chat
  // page opens fresh with this preview beside it (`?new=1&preview=…`) and
  // the record stashed for its chip. Nothing is sent: the person writes
  // the first line.
  const discuss = () => {
    const context = { path: window.location.pathname, title: document.title, record, openedFrom: true as const };
    if (requestAgentSurface({ newChat: true, context })) {
      return;
    }
    stashChatAbout(record);
    const params = new URLSearchParams({ new: '1', [PREVIEW_PARAM]: previewKey(recordRef) });
    router.push(`/dashboard/chat?${params.toString()}`);
  };
  const iconButton = 'flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground';
  const dismiss = props.onClose ?? closePreview;

  return (
    <section
      data-testid="preview-panel"
      data-preview-key={`${recordRef.type}:${recordRef.id}`}
      aria-label={`Preview: ${shown.title}`}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background"
    >
      {/* One line: the kind's icon, the title, then the controls — open the
          full page, share, chat, close — as 32px round ghosts like every other
          panel header. No chip, no underlined link. */}
      <header className="sticky top-0 flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background pr-1.5 pl-3">
        <PreviewIcon type={recordRef.type} doc={shown} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={shown.title}>{shown.title}</h2>
        {shown.href
          ? (
              <Link href={shown.href} onClick={dismiss} data-testid="preview-detail-link" aria-label="Open full page" title="Open full page" className={iconButton}>
                <SquareArrowOutUpRight className="size-4" aria-hidden />
              </Link>
            )
          : shown.externalHref
            ? (
                <a href={shown.externalHref} target="_blank" rel="noopener noreferrer" data-testid="preview-external-link" aria-label={`Open in ${shown.sourceLabel} (leaves Vocion)`} title={`Open in ${shown.sourceLabel}`} className={iconButton}>
                  <ExternalLink className="size-4" aria-hidden />
                </a>
              )
            : null}
        {!props.compact && recordRef.type === 'artifact' && /^\d+$/.test(recordRef.id) && (
          <SharePicker artifactId={Number(recordRef.id)} title={shown.title} dashboardHref={shown.href ?? `/dashboard/artifacts/${recordRef.id}`} />
        )}
        {!props.compact && (
          <button type="button" onClick={discuss} data-testid="preview-discuss" aria-label={`Chat about ${shown.title}`} title="Chat about this" className={iconButton}>
            <MessageSquareText className="size-4" aria-hidden />
          </button>
        )}
        <PanelCloseButton onClick={dismiss} label={props.back ? props.backLabel ?? 'Back to chat' : 'Close preview'} icon={props.back ? <ArrowLeft className="size-4" aria-hidden /> : undefined} testId="preview-close" />
      </header>
      {restarting
        ? <Restarting retrying={retrying} onRetry={retryNow} />
        : !doc && !failure
            ? <p className="px-4 py-3 text-sm text-muted-foreground" role="status">Loading…</p>
            : <Body doc={shown} />}
    </section>
  );
}
