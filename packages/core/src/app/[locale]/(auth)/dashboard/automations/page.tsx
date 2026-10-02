import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/automations → /dashboard/automation (308).
 *
 * The page lives at the singular path its detail pages and run log already
 * hang under (`/dashboard/automation/<slug>`, `/dashboard/automation/runs`);
 * the plural is what people type, and it 404ed (2026-10-01).
 */
export default function AutomationsRedirect(): never {
  permanentRedirect('/dashboard/automation');
}
