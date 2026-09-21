import type { DocumentVerification } from '@/libs/cards/specs';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArtifactHeader } from '@/features/dashboard/artifacts/ArtifactHeader';
import { actionsFor } from '@/features/dashboard/artifacts/headerRules';
import { clerkAuth as auth } from '@/libs/Auth';
import { canOpenArtifact } from '@/libs/share/audience';
import { getArtifact } from '@/services/ArtifactService';

/**
 * A document at full width, on its own — the "Open" of the document frame.
 * The sheets render exactly as the client will read them (the raw HTML the
 * artifact route serves, in a frame at 100%), and the controls that used to
 * be drawn INSIDE the document — the PDF button — sit in the shared
 * `ArtifactHeader` instead, so nothing prints that is not the document (Chris,
 * 2026-09-18). The served HTML is stripped of that button deterministically on
 * the way out (`stripDocumentChrome`), so a row written before this existed
 * does not draw one either.
 *
 * Same header as the pane and the page, minus the verbs this surface cannot
 * support (`actionsFor('open', …)`) — it is a read of ONE version at full
 * screen, so there is no Save, no history and no folder here, and the way back
 * to all of that is the title's back arrow.
 *
 * One scroll: the wrapper is exactly the height the shell gave it and the
 * document scrolls inside its own frame.
 * @param props
 * @param props.params
 */
export default async function OpenDocumentPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const artifactId = Number(id);
  if (!orgId || !Number.isInteger(artifactId) || artifactId <= 0) {
    notFound();
  }
  const row = await getArtifact({ orgId, id: artifactId });
  if (!row || row.kind !== 'document') {
    notFound();
  }
  if (!canOpenArtifact({ audience: row.shareAudience, ownerId: row.shareOwnerId ?? null }, { userId: userId ?? null, isMember: true, hasToken: false })) {
    notFound();
  }
  const verification = (row.spec as { verification?: DocumentVerification }).verification;
  const pages = verification?.pdfPages;

  return (
    <div className="flex h-full min-h-0 flex-col" data-document-open-page>
      <ArtifactHeader
        surface="open"
        artifactId={row.id}
        kind="document"
        title={row.title}
        versionLine={`v${row.currentVersion}`}
        tabs={[]}
        tab="document"
        actions={actionsFor('open', { kind: 'document', hasPdf: Boolean(verification?.pdf) })}
        backHref={`/dashboard/artifacts/${row.id}`}
        conversationId={row.conversationId ?? null}
        pdfHref={verification?.pdf ?? null}
        pdfPages={pages ?? null}
        className="rounded-t-xl border border-b-0 border-border/70"
      />
      <iframe
        title={row.title}
        src={`/api/artifacts/${row.id}/document.html`}
        sandbox="allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        className="min-h-0 w-full flex-1 rounded-b-xl border border-border/70 bg-[#e9e9e4]"
        data-document-open-frame
      />
    </div>
  );
}
