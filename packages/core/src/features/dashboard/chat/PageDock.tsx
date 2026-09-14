'use client';

import type { AgentOption } from './types';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChatDock } from './ChatDock';

/**
 * Routes that mount their own scoped dock (a record page passes its scope
 * and, on a lead, the pending decision). The shell's dock bails there so a
 * page never carries two conversation surfaces (agent-chat-surface.md §6).
 */
export const OWN_DOCK_ROUTES: RegExp[] = [/\/gtm\/lead\//];

/**
 * Single-record pages that do not (yet) mount their own dock: the everything
 * conversation opens by default there, because a person on one record came
 * to work on it (Valerie, 2026-09-09). Anything with its own URL and its own
 * record counts; lists, settings and catalogs do not.
 */
export const RECORD_ROUTES: RegExp[] = [
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
 * The full-page chat IS the conversation; no dock, no button (058).
 * @param pathname
 */
export function isChatPage(pathname: string): boolean {
  return pathname === '/dashboard/chat' || pathname.endsWith('/dashboard/chat');
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
 * The dock on every page that has no dock of its own (058): the everything
 * conversation, carrying the page the person is on as context, collapsed to
 * the button until they open it and open by default on a single record.
 * Mounted once by the app shell, beside the page content, in place of the
 * floating bubble. Renders nothing on the full-page chat, on routes that
 * mount a scoped dock, and for an org with no agents.
 * @param props
 * @param props.agents - Agents available to pick from. Empty array renders nothing.
 */
export function PageDock({ agents }: { agents: AgentOption[] }) {
  const pathname = routeOf(usePathname());
  const [title, setTitle] = useState('');

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

  if (agents.length === 0 || isChatPage(pathname) || isOwnDockRoute(pathname)) {
    return null;
  }

  return (
    <ChatDock
      agents={agents}
      scopeLabel="Everything"
      pageContext={{ path: pathname, title }}
      defaultCollapsed={!isRecordRoute(pathname)}
    />
  );
}
