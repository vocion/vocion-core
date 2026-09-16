import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/canvases → /dashboard/artifacts (308).
 *
 * The canvas was a saved arrangement of tiles; product replaced it with one
 * live artifact and a log of all of them (0101). A permanent redirect, not a
 * delete, because the old path is in pinned nav entries, in the 2026-09-15
 * blog post, and in whatever links people already sent each other.
 */
export default function CanvasesRedirect(): never {
  permanentRedirect('/dashboard/artifacts');
}
