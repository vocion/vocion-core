'use client';

import type { LucideIcon } from 'lucide-react';
import { Loader } from 'lucide-react';
import { useLinkStatus } from 'next/link';
import { cn } from '@/utils/Helpers';

/**
 * A link's icon, swapped for a spinner while that link's navigation is in
 * flight — or, with no icon, a spinner that appears only then.
 *
 * Must be rendered inside a `<Link>` — `useLinkStatus` reads that link's
 * transition state. The sidebar items pass their icon; a card passes none and
 * gets a corner spinner the moment it is tapped, before the new page has
 * rendered a thing (backlog 013). While pending the element carries
 * `data-link-pending`, so the link itself can dim with
 * `has-[[data-link-pending]]:opacity-60` and no state has to be lifted.
 *
 * Why not a `loading.tsx` skeleton for this: a route-level skeleton is a
 * Suspense fallback, and React holds a fallback on screen for a fixed 300 ms
 * once shown (`FALLBACK_THROTTLE_MS` in react-dom) to avoid flicker.
 * Dashboard segments render in 13-46 ms warm, so a full-page skeleton turned
 * a ~97 ms navigation into a ~335 ms one and put a skeleton flash on every
 * tab switch (vocion-core#64). `useLinkStatus` reports the same pending state
 * without mounting a fallback, so the tap is acknowledged immediately and the
 * content still lands as soon as the server responds. The skeletons that do
 * exist sit on the segments that read the database (`Skeletons.tsx`).
 * @param props
 * @param props.icon - The link's normal icon, shown when no navigation is pending. Omit for a spinner-only marker.
 * @param props.className - Placement of the marker (a card puts it in a corner).
 */
export function PendingIcon(props: { icon?: LucideIcon; className?: string }) {
  const { pending } = useLinkStatus();

  if (pending) {
    return <Loader data-link-pending className={cn('animate-spin', props.className)} aria-label="Loading" />;
  }

  const Icon = props.icon;
  return Icon ? <Icon className={props.className} /> : null;
}
