'use client';

import type { AgentOption } from './types';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePageRecord } from '@/features/dashboard/context/PageContextProvider';
import { ChatDock } from './ChatDock';
import { parseConversationParam } from './resumeRule';

/**
 * Routes that mount their own scoped dock (a record page passes its scope
 * and, on a lead, the pending decision). The shell's dock bails there so a
 * page never carries two conversation surfaces (agent-chat-surface.md §6).
 */
export const OWN_DOCK_ROUTES: RegExp[] = [/\/gtm\/lead\//];

/**
 * Screens where a person is answering a question — an ask or a decision
 * sheet — with the action pinned to the bottom of a phone. The dock's button
 * would sit on top of Submit there, and a decision screen is not a place to
 * start a conversation, so the shell mounts no dock at all.
 */
export const NO_DOCK_ROUTES: RegExp[] = [
  /\/dashboard\/inbox\/(?!g(?:\/|$))[^/]+$/,
  /\/dashboard\/inbox\/g\/[^/]+$/,
  /\/dashboard\/inbox\/r\/[^/]+$/,
];

/**
 * Single-record pages that do not (yet) mount their own dock.
 *
 * These used to open the rail by default. They no longer do: a record page is
 * FULL WIDTH when you arrive on it and the rail waits on its edge tab, one
 * ⌘J away (CEO, 2026-09-16 — `docs/design/patterns.md`). The list is kept
 * because it still names "a page that is one record", which is what decides
 * whether the region is commentable and what `@page` resolves to; nothing
 * reads it for collapse state any more.
 */
export const RECORD_ROUTES: RegExp[] = [
  // A briefing is the record a person came to work from (R4): the rail opens
  // beside it, and the page's own composer is gone — one surface (058 §6).
  /\/dashboard\/briefings(?:\/[^/]+)?$/,
  /\/dashboard\/missions\/runs\/[^/]+$/,
  /\/dashboard\/missions\/(?!new$|runs(?:\/|$))[^/]+$/,
  /\/dashboard\/objects\/(?!type(?:\/|$))[^/]+$/,
  /\/dashboard\/agents\/[^/]+$/,
  /\/dashboard\/connectors\/[^/]+$/,
  /\/dashboard\/evals\/[^/]+\/runs\/[^/]+$/,
  /\/dashboard\/adoption\/(?:agents|users)\/[^/]+$/,
  /\/dashboard\/learnings\/[^/]+$/,
];

/**
 * The full-page chat IS the conversation; no dock, no button (058 §6). That
 * includes one conversation expanded beside its artifact
 * (`/dashboard/chat/<id>`), which carries its own transcript and composer.
 * @param pathname
 */
export function isChatPage(pathname: string): boolean {
  return /\/dashboard\/chat(?:\/[^/]+)?$/.test(pathname);
}

export function isOwnDockRoute(pathname: string): boolean {
  return OWN_DOCK_ROUTES.some(re => re.test(pathname));
}

export function isRecordRoute(pathname: string): boolean {
  return RECORD_ROUTES.some(re => re.test(pathname));
}

/**
 * Strip the locale prefix Next adds (`/en/dashboard/...`), so the route rules
 * read the same on every locale.
 * @param pathname
 */
function routeOf(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?:-[A-Z]{2})?(?=\/)/, '');
}

/**
 * The rail on every page that has no dock of its own (058, §9): the
 * everything conversation, carrying the page the person is on as context,
 * collapsed to an edge tab until they open it (⌘J) — on a record page too,
 * since 2026-09-16: the page is full width and the rail overlays it on
 * demand. Mounted once by the app shell, so it follows the person across
 * routes. Renders nothing on the full-page chat, on routes that mount a
 * scoped dock, and for an org with no agents.
 * @param props
 * @param props.agents - Agents available to pick from. Empty array renders nothing.
 */
export function PageDock({ agents }: { agents: AgentOption[] }) {
  const pathname = routeOf(usePathname());
  const [title, setTitle] = useState('');
  // The record the page declared (R4) — travels as `page_context.record`.
  const { record } = usePageRecord();
  // `?conversation=<id>` names a thread to resume (§9) — one of the two
  // intentional returns. Read from the location rather than
  // `useSearchParams` so the shell needs no Suspense boundary.
  const [resumeId, setResumeId] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setResumeId(parseConversationParam(new URLSearchParams(window.location.search).get('conversation')));
  }, [pathname]);

  // The document title settles after the route commits; read it then, and
  // again if the page changes it (a record page titles itself after loading).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
    setTitle(document.title);
    const titleEl = document.querySelector('title');
    if (!titleEl) {
      return;
    }
    const observer = new MutationObserver(() => setTitle(document.title));
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  if (agents.length === 0 || isChatPage(pathname) || isOwnDockRoute(pathname) || NO_DOCK_ROUTES.some(r => r.test(pathname))) {
    return null;
  }

  return (
    <ChatDock
      agents={agents}
      scopeLabel="Everything"
      pageContext={record ? { path: pathname, title, record } : { path: pathname, title }}
      // Full width by default, everywhere. A record page is no longer the
      // exception (2026-09-16).
      defaultCollapsed
      resumeConversationId={resumeId}
    />
  );
}
