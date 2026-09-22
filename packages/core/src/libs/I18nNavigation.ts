'use client';

/**
 * The app's navigation primitives: next-intl's `Link`, `useRouter` and
 * `usePathname`, wrapped so the **workspace travels with the URL**.
 *
 * `/w/<slug>/…` is the canonical URL (`libs/links.ts`). Two things follow, and
 * both are handled here rather than at 130 call sites:
 *
 * - every `Link` and `router.push` to a workspace page is prefixed with the
 *   active slug, so a click keeps the workspace in the address bar without a
 *   round-trip through the proxy's redirect;
 * - `usePathname` gives back the **app path** (`/dashboard/inbox`), because
 *   that is what active-nav matching, the breadcrumb and the page-width rules
 *   compare against — and because it is the one value that is identical on the
 *   server (which sees the rewritten path) and in the browser (which sees the
 *   canonical one). Read the pathname from here, never from `next/navigation`,
 *   or SSR and hydration will disagree.
 *
 * With no workspace in scope ({@link useWorkspaceSlug} null — onboarding, the
 * demo sandbox) every wrapper degrades to plain next-intl behaviour.
 */

import type { ComponentProps } from 'react';
import { createNavigation } from 'next-intl/navigation';
import { createElement, useMemo } from 'react';
import { routing } from './I18nRouting';
import { canonicalise, stripWorkspacePrefix } from './links';
import { useWorkspaceSlug } from './workspaceSlug';

const nav = createNavigation(routing);

/**
 * The current **app** path — locale and workspace stripped.
 * @returns e.g. `/dashboard/inbox`, whatever the address bar says.
 */
export function usePathname(): string {
  return stripWorkspacePrefix(nav.usePathname());
}

/**
 * next-intl's `Link`, with the active workspace kept in the href.
 * @param props - Exactly next-intl's `Link` props.
 */
export function Link(props: ComponentProps<typeof nav.Link>): React.ReactElement {
  const slug = useWorkspaceSlug();
  const href = typeof props.href === 'string' ? canonicalise(props.href, slug) : props.href;
  return createElement(nav.Link, { ...props, href });
}

/**
 * next-intl's router, with the active workspace kept in every navigation.
 *
 * `back`, `forward` and `refresh` pass straight through — they move through
 * history, which already holds canonical URLs.
 */
export function useRouter(): ReturnType<typeof nav.useRouter> {
  const base = nav.useRouter();
  const slug = useWorkspaceSlug();
  return useMemo(() => ({
    ...base,
    push: (href, ...rest) => base.push(typeof href === 'string' ? (canonicalise(href, slug) as typeof href) : href, ...rest),
    replace: (href, ...rest) => base.replace(typeof href === 'string' ? (canonicalise(href, slug) as typeof href) : href, ...rest),
    prefetch: (href, ...rest) => base.prefetch(typeof href === 'string' ? (canonicalise(href, slug) as typeof href) : href, ...rest),
  }), [base, slug]);
}
