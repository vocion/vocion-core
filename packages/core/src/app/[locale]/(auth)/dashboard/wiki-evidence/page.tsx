import type { Metadata } from 'next';
import type { EvidenceOverview } from '@/libs/memory/evidence';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { WikiEvidenceView } from '@/features/dashboard/wikiEvidence/WikiEvidenceView';
import { clerkAuth as auth } from '@/libs/Auth';

export const metadata: Metadata = { title: 'Wiki evidence' };

type Props = { params: Promise<{ locale: string }> };

const EMPTY: EvidenceOverview = { totals: { pages: 0, claims: 0, holding: 0, needCheck: 0, sourcesCited: 0, sourceLinks: 0 }, pages: [], checks: [], replaced: [] };

/**
 * The Wiki evidence page (ADR 0012): which wiki claims still hold against
 * their sources, read for this person's sources only.
 * @param props - Route props.
 * @param props.params - The locale segment.
 */
export default async function WikiEvidencePage(props: Props) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  if (!orgId) {
    notFound();
  }
  const { evidenceEnabled, loadEvidenceOverview } = await import('@/services/memory/EvidenceGraphService');
  const enabled = await evidenceEnabled(orgId);
  let overview = EMPTY;
  if (enabled) {
    const { allowedSourceSlugsForUser } = await import('@/services/SourceAccessService');
    const allowedSourceSlugs = userId ? await allowedSourceSlugsForUser(orgId, userId) : [];
    overview = await loadEvidenceOverview(orgId, { allowedSourceSlugs });
  }
  return <WikiEvidenceView overview={overview} wikiBase="/dashboard/p/wiki" enabled={enabled} />;
}
