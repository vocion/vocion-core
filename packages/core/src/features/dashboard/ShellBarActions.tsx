'use client';

import type { ReactNode } from 'react';
import { createContext, use, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shell-bar actions slot.
 *
 * "Insert quarter, shoot aliens": the chat canvas is messages + composer,
 * period — no floating ⋯ over the conversation. Page-level controls (chat's
 * New chat / Switch agent) belong in the shell top bar next to the one quiet
 * account menu, not on the canvas.
 *
 * The top bar lives in the dashboard layout; the controls are page-owned
 * client state. This bridges the two with a context-held portal target: the
 * layout renders <ShellBarActionsOutlet/> in the header, and a page renders
 * <ShellBarActionsPortal>…</ShellBarActionsPortal> to inject into it. When no
 * page fills the slot (every non-chat page today) the bar just shows the
 * account menu — nothing to clean up.
 */

const ShellBarSlotContext = createContext<HTMLElement | null>(null);
const SetNodeContext = createContext<(el: HTMLElement | null) => void>(() => {});

/**
 * Provider — owns the portal target node. Wrap the header + page content so
 * both the outlet (which sets the node) and the portal (which reads it) share
 * one context.
 * @param props - React children.
 * @param props.children - The header + page content to render inside.
 */
export function ShellBarActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return (
    <SetNodeContext value={setNode}>
      <ShellBarSlotContext value={node}>
        {children}
      </ShellBarSlotContext>
    </SetNodeContext>
  );
}

/** Renders the target node in the shell bar. Place inside the header. */
export function ShellBarActionsOutlet() {
  const setNode = use(SetNodeContext);
  return <div ref={setNode} className="flex items-center" />;
}

/**
 * Portal a page's controls into the shell bar. Renders nothing until the
 * outlet node exists (first client paint).
 * @param props - React children.
 * @param props.children - The controls to place in the shell bar.
 */
export function ShellBarActionsPortal({ children }: { children: ReactNode }) {
  const node = use(ShellBarSlotContext);
  return node ? createPortal(children, node) : null;
}
