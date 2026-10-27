import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Toaster } from '@/components/ui/toast';
import { DeckWindow } from '@/features/dashboard/artifacts/deliverable/DeckWindow';
import { slideIndexFromParam } from '@/features/dashboard/artifacts/deliverable/deckWindowUrl';
import { deliverablePages } from '@/features/dashboard/artifacts/deliverable/pages';
import { clerkAuth as auth } from '@/libs/Auth';
import { canOpenArtifact } from '@/libs/share/audience';
import { getArtifact } from '@/services/ArtifactService';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ slide?: string | string[] }>;
};

/**
 * The deck this window shows, or null — the same three checks as the
 * artifact's own page: signed in to a workspace, the artifact exists there,
 * and its share audience lets this person open it.
 * @param id - The route's id.
 */
async function openableDeck(id: string) {
  const { orgId, userId } = await auth();
  const artifactId = Number(id);
  if (!orgId || !Number.isInteger(artifactId) || artifactId <= 0) {
    return null;
  }
  const row = await getArtifact({ orgId, id: artifactId }).catch(() => null);
  if (!row || row.kind !== 'deck') {
    return null;
  }
  if (!canOpenArtifact({ audience: row.shareAudience, ownerId: row.shareOwnerId ?? null }, { userId: userId ?? null, isMember: true, hasToken: false })) {
    return null;
  }
  return row;
}

/**
 * The window's title bar names the deck. A deck the person may not open keeps
 * the default: its title is not theirs to read.
 * @param props - The route's params.
 */
export async function generateMetadata(props: Pick<Props, 'params'>): Promise<Metadata> {
  const { id } = await props.params;
  const row = await openableDeck(id);
  return row ? { title: row.title } : {};
}

/**
 * /dashboard/artifacts/[id]/window — a deck in a browser window of its own.
 *
 * Opened by the deck's "Open in a new window" (`window.open`, sized 16:9 to
 * the screen, `deckWindowUrl.ts`). It lives in the `(popup)` route group so it
 * carries none of the dashboard's shell: the slides fill the window. Auth is
 * the artifact page's — the proxy signs the person in and resolves the
 * workspace from the URL, and this page applies the same share check.
 * `?slide=N` (1-based) is where it opens; the window keeps it current.
 * @param props - The route props.
 * @param props.params - The locale and the deck id.
 * @param props.searchParams - `?slide=N`.
 */
export default async function DeckWindowPage(props: Props) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const row = await openableDeck(id);
  if (!row) {
    notFound();
  }
  const { slide } = await props.searchParams;
  const total = deliverablePages('deck', row.spec as Record<string, unknown>).length;

  return (
    <>
      <DeckWindow
        artifactId={row.id}
        title={row.title}
        spec={row.spec as Record<string, unknown>}
        start={slideIndexFromParam(slide, total)}
      />
      <Toaster />
    </>
  );
}
