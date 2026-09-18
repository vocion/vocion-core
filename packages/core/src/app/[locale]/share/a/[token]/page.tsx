import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { verifyArtifactShare } from '@/libs/share/artifactShareToken';
import { getArtifact } from '@/services/ArtifactService';
import { resolvePreview } from '@/services/preview/registry';
// Importing the descriptors is what registers them.
import '@/services/preview/descriptors';

export const dynamic = 'force-dynamic';

/**
 * An artifact shared with "anyone with the link" — read-only, no sign-in, no
 * shell. The token names the artifact (`libs/share/artifactShareToken.ts`);
 * the audience is re-checked on every request, so narrowing it back to the
 * workspace turns this page into a 404 for every copy of the link.
 * @param props
 * @param props.params
 */
export default async function SharedArtifactPage(props: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const claim = verifyArtifactShare(token);
  if (!claim) {
    notFound();
  }
  const row = await getArtifact({ orgId: claim.orgId, id: claim.artifactId });
  if (!row || row.shareAudience !== 'anyone') {
    notFound();
  }
  const doc = await resolvePreview({ type: 'artifact', id: String(row.id) }, { orgId: row.orgId, userId: null });
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Shared · read-only</p>
      <h1 className="mt-1 text-2xl font-semibold text-foreground">{row.title}</h1>
      {row.kind === 'document'
        ? (
            <iframe
              title={row.title}
              src={`/api/artifacts/${row.id}/document.html?share=${encodeURIComponent(token)}`}
              sandbox="allow-scripts allow-popups"
              className="mt-6 h-[80vh] w-full rounded-lg border border-border bg-[#e9e9e4]"
            />
          )
        : doc.body
          ? (
              <div className="prose prose-sm mt-6 max-w-none dark:prose-invert">
                <Markdown remarkPlugins={[remarkGfm]}>{doc.body}</Markdown>
              </div>
            )
          : <p className="mt-6 text-sm text-muted-foreground">Nothing readable to show for this artifact.</p>}
    </main>
  );
}
