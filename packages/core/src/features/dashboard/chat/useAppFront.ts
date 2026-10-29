'use client';

import type { AppFront } from '@/libs/chat/appFront';
import { useSyncExternalStore } from 'react';
import { placeIn } from '@/features/dashboard/nav/workspaceMemory';
import { useWorkspaceSlug } from '@/libs/workspaceSlug';

/**
 * The app the person is in here, as the sidebar remembers it
 * (`nav/workspaceMemory.ts`): Chat is shared by every app, so its URL does
 * not say which one. Null on the server and before the browser has said.
 */
function useRememberedApp(): string | null {
  const slug = useWorkspaceSlug();
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('storage', onChange);
      return () => window.removeEventListener('storage', onChange);
    },
    () => placeIn(globalThis.localStorage, slug)?.app ?? null,
    () => null,
  );
}

/**
 * The front of the app the person is in, when it has one. The core app has
 * none: its Chat page stays the warm empty conversation.
 * @param fronts - Every app's front, by app id (`services/chat/appFront.ts`).
 */
export function useAppFront(fronts: Readonly<Record<string, AppFront>> | undefined): AppFront | null {
  const app = useRememberedApp();
  return app && fronts ? fronts[app] ?? null : null;
}
