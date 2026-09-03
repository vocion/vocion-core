'use client';

import type { ReactNode } from 'react';
import { createContext, use, useState } from 'react';
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
 * that carries `data-comment-field` becomes commentable.
 * @param root0 - Component props.
 * @param root0.targetRef - The document being commented on, e.g. `lead_brief:412`.
 * @param root0.children - The document and the agent surface.
 */
export function CommentLayerProvider({ targetRef, children }: {
  targetRef: string;
  children: ReactNode;
}) {
  // The container is state, not a ref: the hook needs it in effect deps, and
  // a hook returning a ref would make every read of its result a ref access
  // during render.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const layer = useAnchoredComments({ targetRef, root });
  return (
    <CommentLayerContext value={layer}>
      <div ref={setRoot} className="flex min-w-0 flex-1 items-start">
        {children}
      </div>
      {/* Keyed by the selection: a new selection mounts a fresh control with
          an empty note, instead of an effect resetting the old one. */}
      <CommentPopover
        key={layer.pending ? `${layer.pending.field}:${layer.pending.anchor.quote}` : 'none'}
        pending={layer.pending}
        onAdd={note => void layer.addComment(note)}
        onCancel={layer.cancelPending}
        onBegin={layer.beginCommenting}
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
