'use client';

/**
 * AN ARTIFACT AS AN ENTRY IN THE PANE.
 *
 * Until 2026-10-23 an artifact had two homes: the conversation route's own
 * split (`ConversationSplit`, its own reducer and its own `?artifact=`), and
 * a text-only peek here that showed none of what makes an artifact one — no
 * rendered sheets, no versions, no download. Chris: "We should only have one
 * sidebar and panes UX for all use cases." So the pane opens an artifact as
 * the artifact itself: `ArtifactPane` with its own header, tabs, versions and
 * actions, in whatever host draws the pane — the rail, the preview's own
 * column, or the phone drawer.
 *
 * It reads the artifact by id, keeps a one-entry `artifactReducer` for the
 * edit-under-an-agent-write case, and reloads in place when a version is
 * written (`useVersionRefresh`), as `StandaloneArtifactView` does.
 */

import type { ArtifactEntry } from '@/features/dashboard/artifacts/artifactReducer';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useReducer, useState } from 'react';
import { BAR_ICON_BUTTON } from '@/components/ui/buttonVariants';
import { ArtifactPane } from '@/features/dashboard/artifacts/ArtifactPane';
import { artifactReducer, initialArtifactPaneState, openArtifact } from '@/features/dashboard/artifacts/artifactReducer';
import { useVersionRefresh } from '@/features/dashboard/versions/VersionWatch';
import { client } from '@/libs/Orpc';
import { describeRef } from '@/libs/preview/describeRef';
import { parsePreviewKey } from '@/libs/preview/types';
import { RECORD_TYPES } from '@/services/chat/pageContext';
import { closePreview, closePreviewEntry, previewBack, previewTitle, rememberPreviewTitle, usePreviewStack } from './previewState';

function isRecordType(s: string): s is (typeof RECORD_TYPES)[number] {
  return (RECORD_TYPES as readonly string[]).includes(s);
}

/**
 * @param props - The entry.
 * @param props.id - The artifact's id.
 * @param props.onClose - The host's own close, when it has one.
 * @param props.inDrawer - In the phone drawer: the close closes this entry only.
 */
export function ArtifactPreview({ id, onClose, inDrawer = false }: { id: number; onClose?: () => void; inDrawer?: boolean }) {
  const key = `artifact:${id}`;
  const [state, dispatch] = useReducer(artifactReducer, initialArtifactPaneState);
  const [missing, setMissing] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    client.artifacts.get({ id })
      .then((a) => {
        if (live) {
          dispatch({ type: 'upsert', artifact: a as ArtifactEntry, focus: true });
        }
      })
      .catch((error: unknown) => {
        if (live) {
          console.warn('ArtifactPreview: could not read the artifact', error);
          setMissing(true);
        }
      });
    return () => {
      live = false;
    };
  }, [id, round]);

  const artifact = openArtifact(state);
  useVersionRefresh({
    refs: [{ type: 'artifact', id: String(id) }],
    root: () => (typeof document === 'undefined' ? null : document.querySelector(`[data-preview-key="${key}"] [data-artifact-body]`)),
    refetch: () => setRound(r => r + 1),
    settled: artifact?.version,
    ready: true,
  });
  useEffect(() => {
    if (artifact?.title) {
      rememberPreviewTitle(key, artifact.title);
    }
  }, [key, artifact?.title]);

  const close = onClose ?? (inDrawer ? () => closePreviewEntry(key) : closePreview);

  return (
    <section data-testid="preview-panel" data-preview-key={key} aria-label={`Preview: ${artifact?.title ?? describeRef({ type: 'artifact', id: String(id) }).label}`} className="flex min-h-0 flex-1 flex-col bg-background">
      {!onClose && !inDrawer && <StackBack />}
      {artifact
        ? (
            <ArtifactPane
              key={artifact.id}
              artifact={artifact}
              conflict={state.conflict}
              onBeginEdit={() => dispatch({ type: 'beginEdit' })}
              onEndEdit={() => dispatch({ type: 'endEdit' })}
              onDismissConflict={() => dispatch({ type: 'dismissConflict' })}
              onUpdated={a => dispatch({ type: 'upsert', artifact: a, focus: true })}
              onClose={close}
              conversationId={artifact.conversationId ?? null}
            />
          )
        : missing
          ? <p className="px-4 py-3 text-sm text-muted-foreground" role="status">Could not load this artifact. It may have been removed, or it is not in this workspace.</p>
          : <p className="px-4 py-3 text-sm text-muted-foreground" role="status">Loading…</p>}
    </section>
  );
}

/**
 * The way back down the pane's stack above an artifact, on a desktop column:
 * an artifact wears its own header, so the back control stands on a slim
 * strip above it rather than in it. Nothing when the pane has nothing under
 * its top; on a phone the drawer's tabs do this instead.
 */
export function StackBack() {
  const stacked = usePreviewStack();
  const underneath = stacked.at(-1);
  const below = underneath ? parsePreviewKey(underneath, isRecordType) : null;
  const label = below && underneath ? previewTitle(underneath) ?? describeRef(below).label : null;
  if (!label) {
    return null;
  }
  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border pl-1.5">
      <button type="button" onClick={previewBack} data-testid="preview-stack-back" aria-label={`Back to ${label}`} title={`Back to ${label}`} className={BAR_ICON_BUTTON}>
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{label}</span>
    </div>
  );
}
