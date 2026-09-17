import { permanentRedirect } from 'next/navigation';
import { reviewRedirectTarget } from '@/features/dashboard/inbox/reviewRedirect';

/**
 * Review is no longer a place. Two surfaces asked a person to do the same
 * job — read the evidence, decide, let the system learn — so the review
 * queue became the `proposal` kind on "Review queue" (`/dashboard/inbox`), and
 * this route only forwards. 308, so a bookmark or a mailed link is corrected
 * once and stays corrected; `?type=` (the old filter) becomes `?actionKind=`.
 */

export const dynamic = 'force-dynamic';

export default async function ReviewRedirectPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  permanentRedirect(reviewRedirectTarget(await props.searchParams));
}
