import { ReportSkeleton } from '@/components/patterns/Skeletons';

/**
 * One record's page — a feature report, or a wiki page by slug — while it
 * assembles. Both are a title, a context line and sections of prose, so one
 * skeleton stands in for both (`patterns/Skeletons`).
 *
 * Safe to wrap in Suspense: this route only redirects on a broken session
 * and only 404s on an unknown page, never on the normal render (see the
 * sibling `../loading.tsx` for why that matters).
 */
export default function WorkspaceRecordLoading() {
  return <ReportSkeleton />;
}
