'use client';

import { SessionProvider } from 'next-auth/react';
import { WorkspaceSlugProvider } from '@/libs/workspaceSlug';

/**
 * The client context every signed-in page sits in: the auth session, and the
 * workspace the URL names.
 *
 * Both are read on the server — the session from the cookie, the workspace
 * from the header the proxy set — and published here, so a `Link` renders the
 * same href on the server and in the browser.
 * @param props - `workspaceSlug` from the request; `children` the app.
 * @param props.workspaceSlug - `project.slug` the canonical URL names, or null.
 * @param props.children - The signed-in app.
 */
export function AuthProviders(props: { workspaceSlug: string | null; children: React.ReactNode }) {
  // auth.js's SessionProvider exposes `useSession()` to client components.
  // No-op cookie handling — auth.js reads its session cookie automatically.
  return (
    <SessionProvider>
      <WorkspaceSlugProvider slug={props.workspaceSlug}>{props.children}</WorkspaceSlugProvider>
    </SessionProvider>
  );
}
