import { redirect } from 'next/navigation';

/**
 * Logs folded into Activity — run history is a kind of activity, not a
 * separate surface. Old bookmarks land on the combined stream.
 */
export default function LogsPage() {
  redirect('/dashboard/activity');
}
