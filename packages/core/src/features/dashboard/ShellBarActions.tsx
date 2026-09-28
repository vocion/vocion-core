'use client';

import type { ReactNode } from 'react';
import { createContext, use, useEffect, useState } from 'react';
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
 *
 * The same bridge carries a TITLE: a page that has a name of its own — the
 * full-page chat, named by its thread — renders <ShellBarTitlePortal> and the
 * bar shows that where the breadcrumb was ("Squatch Factory" said which
 * workspace, which the sidebar already says, and not which conversation).
 * While a page holds the title slot the breadcrumb steps aside.
 */

const ShellBarSlotContext = createContext<HTMLElement | null>(null);
const SetNodeContext = createContext<(el: HTMLElement | null) => void>(() => {});
const TitleSlotContext = createContext<HTMLElement | null>(null);
const SetTitleNodeContext = createContext<(el: HTMLElement | null) => void>(() => {});
const TitleClaimContext = createContext<{ claimed: boolean; claim: (delta: 1 | -1) => void }>({ claimed: false, claim: () => {} });

/**
 * Provider — owns the portal target node. Wrap the header + page content so
 * both the outlet (which sets the node) and the portal (which reads it) share
 * one context.
 * @param props - React children.
 * @param props.children - The header + page content to render inside.
 */
export function ShellBarActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [titleNode, setTitleNode] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState(0);
  const [claim] = useState(() => (delta: 1 | -1) => setClaims(n => Math.max(0, n + delta)));
  return (
    <SetNodeContext value={setNode}>
      <ShellBarSlotContext value={node}>
        <SetTitleNodeContext value={setTitleNode}>
          <TitleSlotContext value={titleNode}>
            <TitleClaimContext value={{ claimed: claims > 0, claim }}>
              {children}
            </TitleClaimContext>
          </TitleSlotContext>
        </SetTitleNodeContext>
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

/** Renders the title target in the shell bar. Place where the breadcrumb sits. */
export function ShellBarTitleOutlet() {
  const setNode = use(SetTitleNodeContext);
  return <div ref={setNode} className="flex min-w-0 items-center empty:hidden" data-testid="shell-bar-title" />;
}

/** True while a page holds the title slot — the breadcrumb steps aside. */
export function useShellBarTitleClaimed(): boolean {
  return use(TitleClaimContext).claimed;
}

/**
 * Portal a page's own name into the shell bar, in place of the breadcrumb.
 * Holds the slot for as long as it is mounted.
 * @param props - React children.
 * @param props.children - The title to show.
 */
export function ShellBarTitlePortal({ children }: { children: ReactNode }) {
  const node = use(TitleSlotContext);
  const { claim } = use(TitleClaimContext);
  useEffect(() => {
    claim(1);
    return () => claim(-1);
  }, [claim]);
  return node ? createPortal(children, node) : null;
}
