'use client';

import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import { WorkspaceSlugProvider } from '@/libs/workspaceSlug';

/**
 * The client context every signed-in page sits in: the auth session, and the
 * workspace the URL names.
 *
 * Both are read on the server — the session from the cookie, the workspace
 * from the header the proxy set — and published here, so a `Link` renders the
 * same href on the server and in the browser.
 * @param props - `session` and `workspaceSlug` from the request; `children` the app.
 * @param props.session - The session as the server read it, so nothing fetches it again on load.
 * @param props.workspaceSlug - `project.slug` the canonical URL names, or null.
 * @param props.children - The signed-in app.
 */
export function AuthProviders(props: { session: Session | null; workspaceSlug: string | null; children: React.ReactNode }) {
  // auth.js's SessionProvider exposes `useSession()` to client components.
  // Seeded with the server's read, it skips its fetch on mount and still
  // refreshes when the tab regains focus.
  return (
    <SessionProvider session={props.session}>
      <WorkspaceSlugProvider slug={props.workspaceSlug}>{props.children}</WorkspaceSlugProvider>
    </SessionProvider>
  );
}
