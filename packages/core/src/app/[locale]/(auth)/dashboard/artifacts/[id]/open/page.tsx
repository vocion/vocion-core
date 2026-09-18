import type { DocumentVerification } from '@/libs/cards/specs';
import { ArrowLeft, FileDown } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { canOpenArtifact } from '@/libs/share/audience';
import { getArtifact } from '@/services/ArtifactService';

/**
 * A document at full width, on its own — the "Open" of the document frame.
 * The sheets render exactly as the client will read them (the raw HTML the
 * artifact route serves, in a frame at 100%), and the controls that used to
 * be drawn INSIDE the document — the PDF button — sit in this wrapper's bar
 * instead, so nothing prints that is not the document (Chris, 2026-09-18).
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
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3" data-document-open-page>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <Link href={`/dashboard/artifacts/${row.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden />
          {row.title}
        </Link>
        <span>{`v${row.currentVersion}`}</span>
        {pages != null && <span>{`PDF ${pages} ${pages === 1 ? 'page' : 'pages'}`}</span>}
        {verification?.pdf && (
          <a href={verification.pdf} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-foreground" data-document-pdf>
            <FileDown className="size-3" aria-hidden />
            PDF
          </a>
        )}
      </div>
      <iframe
        title={row.title}
        src={`/api/artifacts/${row.id}/document.html`}
        sandbox="allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin"
        className="min-h-0 w-full flex-1 rounded-lg border border-border/70 bg-[#e9e9e4]"
        data-document-open-frame
      />
    </div>
  );
}
