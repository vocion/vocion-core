import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PublicFeatureView } from '@/features/share/PublicFeatureView';
import { sharedFeatureMetadata } from '@/features/share/shareMetadata';
import { requestOrigin } from '@/libs/http/publicOrigin';
import { loadSharedFeature } from '@/services/factory/featureShareData';

export const dynamic = 'force-dynamic';

/** One read per request: the title and the page come from the same load. */
const load = cache(async (token: string) => loadSharedFeature(token));

/**
 * Never indexed, never followed, and no referrer leaves it: a link a person
 * pasted somewhere is for the people they pasted it to — and where they
 * pasted it, it unfurls to the feature's card (`sharedFeatureMetadata`).
 * @param props
 * @param props.params
 */
export async function generateMetadata(props: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await props.params;
  const page = await load(token).catch(() => null);
  return sharedFeatureMetadata(page, requestOrigin(await headers()));
}

/**
 * A feature shared with "anyone with the link" — read-only, no sign-in, no
 * shell (`services/factory/featureShare.ts`). The token names the link; the
 * link is re-checked on every request, so Stop sharing turns every copy of
 * it into this same 404, as does a token that was never real.
 * @param props
 * @param props.params
 */
export default async function SharedFeaturePage(props: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const page = await load(token);
  if (!page) {
    notFound();
  }
  return <PublicFeatureView page={page} />;
}
