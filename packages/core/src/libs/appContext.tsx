'use client';

import type { AppNav } from '@/features/navigation/apps';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, use, useSyncExternalStore } from 'react';
import { NAV_PLACE_EVENT, placeIn } from '@/features/dashboard/nav/workspaceMemory';
import { resolveActiveApp } from '@/features/navigation/apps';
import { appPathname } from './appLinks';
import { useWorkspaceSlug } from './workspaceSlug';

const AppContext = createContext<string | null>(null);

/** App context is navigation, never an authorization boundary. */
export function useAppContext(): string | null {
  return use(AppContext);
}

/**
 * Resolve only apps installed in this workspace; deep links win over memory.
 * @param root0
 * @param root0.apps
 * @param root0.children
 */
export function AppContextProvider({ apps, children }: { apps: Array<Pick<AppNav, 'id' | 'core' | 'owns' | 'entry'>>; children: React.ReactNode }) {
  const pathname = appPathname(usePathname());
  const params = useSearchParams();
  const workspace = useWorkspaceSlug();
  const remembered = useSyncExternalStore(subscribe, () => placeIn(globalThis.localStorage, workspace)?.app ?? null, () => null);
  const active = resolveActiveApp({ pathname, apps, explicit: params.get('app'), remembered });
  return <AppContext value={active ?? null}>{children}</AppContext>;
}

/**
 * Subscribe to navigation storage without changing the current URL.
 * @param notify
 */
function subscribe(notify: () => void) {
  globalThis.addEventListener('storage', notify);
  globalThis.addEventListener(NAV_PLACE_EVENT, notify);
  return () => {
    globalThis.removeEventListener('storage', notify);
    globalThis.removeEventListener(NAV_PLACE_EVENT, notify);
  };
}
