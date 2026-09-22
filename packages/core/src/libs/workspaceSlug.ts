'use client';

/**
 * The workspace the current page is about, for the code that builds links.
 *
 * The canonical URL carries it (`/w/<slug>/…`, `libs/links.ts`), the proxy
 * resolves it, and the `(auth)` layout reads it off the request header and
 * hands it down here — one value, set on the server, identical on the client,
 * so a `Link`'s href does not change between SSR and hydration.
 *
 * Null means "no workspace in this URL": onboarding, sign-in, the demo
 * sandbox, or any page rendered outside the provider. Every consumer must
 * degrade to an unprefixed link rather than guess — a bare link still works,
 * the proxy just sends it to its canonical spelling on arrival.
 */

import { createContext, createElement, use } from 'react';

const WorkspaceSlugContext = createContext<string | null>(null);

/**
 * The active workspace slug, or null when this page has none.
 *
 * Kept out of `I18nNavigation` so a component can read the slug without
 * pulling in the navigation wrappers.
 */
export function useWorkspaceSlug(): string | null {
  return use(WorkspaceSlugContext);
}

/**
 * Publishes the slug the server resolved. Mounted once, in the `(auth)`
 * layout — the whole signed-in app sits under it.
 * @param props - `slug` from the request header; `children` the app.
 * @param props.slug - `project.slug` of the workspace the URL names, or null.
 * @param props.children - The subtree that may build workspace links.
 */
export function WorkspaceSlugProvider(props: { slug: string | null; children: React.ReactNode }): React.ReactElement {
  return createElement(WorkspaceSlugContext.Provider, { value: props.slug }, props.children);
}
