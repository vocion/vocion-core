'use client';

import type { ReactNode } from 'react';
import type { Crumb } from './breadcrumbModel';
import { usePathname } from 'next/navigation';
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';
import { parseWorkspacePath } from '@/libs/links';

type Registration = { key: string; crumbs: Crumb[]; token: symbol };
type TrailContext = { registration: Registration | null; register: (pathname: string, crumbs: Crumb[]) => () => void };
const Context = createContext<TrailContext | null>(null);

/**
 * Locale-independent identity which keeps different workspaces distinct.
 * @param pathname
 */
function routeKey(pathname: string): string {
  const path = parseWorkspacePath(pathname);
  return path ? `${path.slug}:${path.appPath}` : pathname.split(/[?#]/)[0]!;
}

/**
 * One shell owns its registrations; no browser-global breadcrumb state.
 * @param root0
 * @param root0.children
 */
export function BreadcrumbTrailProvider({ children }: { children: ReactNode }) {
  const [registration, setRegistration] = useState<Registration | null>(null);
  const register = useCallback((pathname: string, crumbs: Crumb[]) => {
    const token = Symbol('breadcrumb trail');
    setRegistration({ key: routeKey(pathname), crumbs, token });
    return () => setRegistration(current => current?.token === token ? null : current);
  }, []);
  const value = useMemo(() => ({ registration, register }), [registration, register]);
  return <Context value={value}>{children}</Context>;
}

/**
 * Register a server-resolved trail for one exact canonical page URL.
 * The pathname is supplied by that page, never inferred from a later navigation.
 * @param props - The page identity and meaningful collection/project/record trail.
 * @param props.pathname
 * @param props.crumbs
 */
export function PageBreadcrumbs({ pathname, crumbs }: { pathname: string; crumbs: Crumb[] }) {
  const register = use(Context)?.register;
  const serialized = JSON.stringify(crumbs);
  useEffect(() => register?.(pathname, JSON.parse(serialized) as Crumb[]), [register, pathname, serialized]);
  return null;
}

/** Ignore an old page's registration immediately, even before effect cleanup runs. */
export function useExplicitBreadcrumbTrail(): Crumb[] | null {
  const registration = use(Context)?.registration;
  const pathname = usePathname();
  return registration && pathname && registration.key === routeKey(pathname) ? registration.crumbs : null;
}
