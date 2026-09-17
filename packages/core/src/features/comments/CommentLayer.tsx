'use client';

import type { ReactNode } from 'react';
import type { RecordRef } from '@/services/chat/pageContext';
import { createContext, use, useCallback, useState } from 'react';
import { requestAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { changeRef } from '@/features/dashboard/chat/composerTags';
import { CommentPopover, useAnchoredComments } from './AnchoredComments';

/**
 * One comment layer per record page, shared by the document and the agent
 * surface beside it.
 *
 * The document and the dock are siblings in the page, but a note taken in one
 * has to appear as a chip in the other and clear from both when the agent
 * applies it. A context keeps that one layer rather than two that drift —
 * the mistake 032 exists to prevent, one level down.
 */

type Layer = ReturnType<typeof useAnchoredComments> | null;

const CommentLayerContext = createContext<Layer>(null);

/**
 * Provides the layer and renders the selection control. Everything inside
 * that carries `data-comment-field` becomes commentable — that attribute is
 * the whole opt-in, per region, and it is how a Detail page gets
 * select-to-talk (`docs/design/patterns.md`).
 *
 * Both actions on the control end at the SAME place: `requestAgentSurface`,
 * the one entry function (agent-chat-surface.md §6). *Ask about this* sends
 * the passage as `PageContext.selection` and nothing else. *Add change*
 * sends the passage AND the `@change` tag, which is what makes the send path
 * route to the sequence-draft rewrite.
 * @param root0 - Component props.
 * @param root0.targetRef - The document being commented on, e.g. `lead_brief:412`.
 * @param root0.children - The document and the agent surface.
 * @param root0.record - The record the page is about, carried with the passage.
 * @param root0.changeIntent - True where a sequence draft is in view: offers *Add change*.
 */
export function CommentLayerProvider({ targetRef, children, record, changeIntent = false }: {
  targetRef: string;
  children: ReactNode;
  record?: RecordRef;
  changeIntent?: boolean;
}) {
  // The container is state, not a ref: the hook needs it in effect deps, and
  // a hook returning a ref would make every read of its result a ref access
  // during render.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const layer = useAnchoredComments({ targetRef, root });
  const { pending, cancelPending } = layer;

  const contextFor = useCallback((quote: string) => ({
    path: typeof window === 'undefined' ? '' : window.location.pathname,
    title: typeof document === 'undefined' ? '' : document.title,
    ...(record ? { record } : {}),
    selection: { text: quote, quote: true as const },
    openedFrom: true as const,
  }), [record]);

  const askAboutSelection = useCallback(() => {
    if (!pending) {
      return;
    }
    const quote = pending.anchor.quote;
    cancelPending();
    window.getSelection()?.removeAllRanges();
    requestAgentSurface({ context: contextFor(quote) });
  }, [pending, cancelPending, contextFor]);

  const addChange = useCallback(async (note: string) => {
    const quote = pending?.anchor.quote ?? '';
    await layer.addComment(note);
    // The tag is what gives the note its power: the rail's send path reads
    // `@change` and routes to `rewriteDraft` instead of answering.
    requestAgentSurface({ context: contextFor(quote), tags: [changeRef()] });
  }, [pending, layer, contextFor]);

  return (
    <CommentLayerContext value={layer}>
      <div ref={setRoot} className="flex min-w-0 flex-1 items-start">
        {children}
      </div>
      {/* Keyed by the selection: a new selection mounts a fresh control with
          an empty note, instead of an effect resetting the old one. */}
      <CommentPopover
        key={pending ? `${pending.field}:${pending.anchor.quote}` : 'none'}
        pending={pending}
        onAsk={askAboutSelection}
        onAdd={note => void addChange(note)}
        onCancel={cancelPending}
        onBegin={layer.beginCommenting}
        changeLabel={changeIntent ? 'Add change' : undefined}
      />
    </CommentLayerContext>
  );
}

/**
 * The layer, or null on a page without one — every consumer degrades to
 * rendering nothing rather than requiring the provider.
 * @returns The comment layer when a provider is above, else null.
 */
export function useCommentLayer(): Layer {
  return use(CommentLayerContext);
}
