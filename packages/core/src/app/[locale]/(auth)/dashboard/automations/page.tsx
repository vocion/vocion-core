import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/automations → /dashboard/automation (308).
 *
 * The page lives at the singular path its detail pages and run log already
 * hang under (`/dashboard/automation/<slug>`, `/dashboard/automation/runs`);
 * the plural is what people type, and it 404ed (2026-10-01).
 */
export default async function AutomationsRedirect(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<never> {
  // The filter travels with it: `/dashboard/automations?app=seo` opens filtered.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await props.searchParams)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, v);
    }
  }
  const query = params.toString();
  permanentRedirect(`/dashboard/automation${query ? `?${query}` : ''}`);
}
