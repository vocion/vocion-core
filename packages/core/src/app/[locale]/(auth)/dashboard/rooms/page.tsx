import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/rooms → /dashboard/projects (308). Projects were called data
 * rooms before 2026-10-27; the old path is in pinned nav entries, stored
 * links and conversations, so it redirects rather than 404s.
 */
export default function RoomsRedirect(): never {
  permanentRedirect('/dashboard/projects');
}
