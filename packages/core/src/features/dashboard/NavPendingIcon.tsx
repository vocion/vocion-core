'use client';

import type { LucideIcon } from 'lucide-react';
import { Loader } from 'lucide-react';
import { useLinkStatus } from 'next/link';

/**
 * A sidebar item's icon, swapped for a spinner while that item's navigation is
 * in flight.
 *
 * Why not a `loading.tsx` skeleton: a route-level skeleton is a Suspense
 * fallback, and React holds a fallback on screen for a fixed 300 ms once shown
 * (`FALLBACK_THROTTLE_MS` in react-dom) to avoid flicker. Dashboard segments
 * render in 13-46 ms warm, so a full-page skeleton turned a ~97 ms navigation
 * into a ~335 ms one and put a skeleton flash on every tab switch
 * (vocion-core#64). `useLinkStatus` reports the same pending state without
 * mounting a fallback, so the click is acknowledged immediately and the content
 * still lands as soon as the server responds.
 *
 * Must be rendered inside a `<Link>` — `useLinkStatus` reads that link's
 * transition state.
 * @param props
 * @param props.icon - The item's normal icon, shown when no navigation is pending.
 */
export function NavPendingIcon(props: { icon: LucideIcon }) {
  const { pending } = useLinkStatus();

  if (pending) {
    return <Loader className="animate-spin" aria-label="Loading" />;
  }

  const Icon = props.icon;
  return <Icon />;
}
