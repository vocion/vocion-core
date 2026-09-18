'use client';

import type { PreviewDoc } from '@/libs/preview/types';
import type { RecordRef, RecordType } from '@/services/chat/pageContext';
import { ArrowLeft, Bot, ExternalLink, FileText, Inbox, MessageSquareText, Newspaper, Play, Rocket, SquareArrowOutUpRight, Target, User, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PanelCloseButton } from '@/components/ui/panel-close-button';
import { ARTIFACT_KIND_ICON } from '@/features/dashboard/artifacts/kinds';
import { SharePicker } from '@/features/dashboard/artifacts/SharePicker';
import { requestAgentSurface, stashChatAbout } from '@/features/dashboard/chat/agentSurface';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { PREVIEW_PARAM, previewKey } from '@/libs/preview/types';
import { closePreview } from './previewState';

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

function Body(props: { doc: PreviewDoc }) {
  const { doc } = props;
  if (doc.unresolved) {
    return (
      <div className="px-4 py-3">
        <p className="text-sm text-muted-foreground">{doc.unresolved.reason}</p>
        <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Reference</p>
        <p className="mt-1 font-mono text-[12px] break-all text-foreground">{doc.unresolved.reference}</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
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
        ? (
            <div className="prose prose-sm max-w-none border-t border-rule pt-3 dark:prose-invert">
              <Markdown remarkPlugins={[remarkGfm]}>{doc.body}</Markdown>
            </div>
          )
        : <p className="border-t border-rule pt-3 text-sm text-muted-foreground">No text was synced for this reference.</p>}
      {doc.truncated && <p className="mt-3 text-xs text-muted-foreground">Cut short — open the full page for the rest.</p>}
    </div>
  );
}

/**
 * @param props
 * @param props.recordRef - What to show.
 * @param props.back - On a small screen the column is a sheet, so the preview
 * replaces its content rather than splitting it in two; the close control
 * becomes "back to chat" and says so.
 */
export function PreviewPane(props: { recordRef: Pick<RecordRef, 'type' | 'id'>; back?: boolean }) {
  const { recordRef } = props;
  const [doc, setDoc] = useState<PreviewDoc | null>(null);
  const [failed, setFailed] = useState(false);

  // The pane is keyed on the ref by its parent, so a new reference remounts it
  // and the loading state is the initial state — no reset needed here.
  useEffect(() => {
    let live = true;
    client.preview.get({ type: recordRef.type, id: recordRef.id })
      .then((d) => {
        if (live) {
          setDoc(d as PreviewDoc);
        }
      })
      .catch(() => {
        if (live) {
          setFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [recordRef.type, recordRef.id]);

  const shown: PreviewDoc = doc ?? {
    ref: { type: recordRef.type, id: recordRef.id },
    title: failed ? 'Could not load this reference' : 'Loading…',
    sourceLabel: 'Preview',
    ...(failed ? { unresolved: { reason: 'The preview did not load. The reference is below.', reference: recordRef.id } } : {}),
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
              <Link href={shown.href} onClick={closePreview} data-testid="preview-detail-link" aria-label="Open full page" title="Open full page" className={iconButton}>
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
        {recordRef.type === 'artifact' && /^\d+$/.test(recordRef.id) && (
          <SharePicker artifactId={Number(recordRef.id)} title={shown.title} dashboardHref={shown.href ?? `/dashboard/artifacts/${recordRef.id}`} />
        )}
        <button type="button" onClick={discuss} data-testid="preview-discuss" aria-label={`Chat about ${shown.title}`} title="Chat about this" className={iconButton}>
          <MessageSquareText className="size-4" aria-hidden />
        </button>
        <PanelCloseButton onClick={closePreview} label={props.back ? 'Back to chat' : 'Close preview'} icon={props.back ? <ArrowLeft className="size-4" aria-hidden /> : undefined} testId="preview-close" />
      </header>
      <Body doc={shown} />
    </section>
  );
}
