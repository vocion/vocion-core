import type { SeoPageMeta } from '@/services/seo/records';
import { FactList } from '@/components/patterns';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { StandaloneArtifactView } from '@/features/dashboard/artifacts/StandaloneArtifactView';
import { ObjectWorkspace } from '@/features/dashboard/objects/ObjectWorkspace';
import { RecordHistory } from '@/features/dashboard/objects/RecordHistory';
import { Link } from '@/libs/I18nNavigation';
import { getAsk } from '@/services/AskService';
import { editorialArtifact } from '@/services/objects/editorialArtifact';
import { readSeoRoadmap } from '@/services/seo/roadmap';
import { WriteApiError } from '@/services/writeApi';
import { SeoPublicationPanel } from './SeoPublicationPanel';

/**
 * The existing artifact editor, guarded by both workspace and artifact audience.
 * @param root0
 * @param root0.orgId
 * @param root0.userId
 * @param root0.id
 * @param root0.empty
 */
async function PageArtifact({ orgId, userId, id, empty }: { orgId: string; userId: string | null; id?: number; empty: string }) {
  if (!Number.isSafeInteger(id) || !id || id < 1) {
    return <p className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">{empty}</p>;
  }
  const artifact = await editorialArtifact(orgId, userId, id);
  if (!artifact) {
    return <p className="rounded-xl border p-8 text-sm text-muted-foreground">This document is unavailable or not shared with you.</p>;
  }
  return <div className="flex h-[70vh] min-h-96 flex-col overflow-hidden rounded-xl border border-border"><StandaloneArtifactView key={artifact.id} artifact={artifact} selfId={userId} conversationId={artifact.conversationId ?? null} /></div>;
}

/**
 * An editorial workspace, using the existing draft editor and version-bound sign-off.
 * @param root0
 * @param root0.orgId
 * @param root0.userId
 * @param root0.objectId
 * @param root0.title
 * @param root0.meta
 */
export async function SeoPageWorkspace({ orgId, userId, objectId, title, meta }: { orgId: string; userId: string | null; objectId: number; title: string; meta: Record<string, unknown> }) {
  const m = meta as Partial<SeoPageMeta>;
  let canVerify = false;
  if (userId && Number.isSafeInteger(m.projectId) && m.projectId! > 0 && m.status === 'published') {
    try {
      canVerify = (await readSeoRoadmap(orgId, m.projectId!, userId)).canEdit;
    } catch (error) {
      if (!(error instanceof WriteApiError) || error.status !== 404) {
        throw error;
      }
    }
  }
  const askId = m.signoffAsk?.askId;
  const ask = typeof askId === 'number' && askId > 0 ? await getAsk(orgId, askId) : null;
  const reviewHref = ask?.objectRefs?.some(ref => ref.type === 'object' && ref.id === String(objectId)) ? `/dashboard/inbox/${ask.id}` : null;
  const author = m.author && typeof m.author === 'object' ? m.author : null;
  const draft = <PageArtifact orgId={orgId} userId={userId} id={m.draftArtifactId} empty="No draft yet. Research and a page brief come before writing." />;
  return (
    <ObjectWorkspace
      label="Page workspace"
      sections={[
        { id: 'draft', label: 'Draft', content: draft },
        { id: 'brief', label: 'Brief & research', content: (
          <div className="space-y-6">
            <h2 className="text-sm font-semibold">Page brief</h2>
            <PageArtifact orgId={orgId} userId={userId} id={m.briefArtifactId} empty="No page brief yet." />
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm font-medium">Search research</summary>
              <div className="mt-4"><PageArtifact orgId={orgId} userId={userId} id={m.serpArtifactId} empty="No search research yet." /></div>
            </details>
          </div>
        ) },
        { id: 'review', label: 'Review & feedback', content: (
          <div className="space-y-6">
            <section className="rounded-xl border p-5">
              <h2 className="text-base font-semibold">Editorial review</h2>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{m.review?.notes || 'The editor has not recorded a review yet.'}</p>
              {m.review?.verdict && <p className="mt-3 text-sm font-medium">{m.review.verdict === 'pass' ? 'Editor check passed' : 'Editor requested changes'}</p>}
              {m.review?.findings?.length
                ? (
                    <ul className="mt-4 space-y-3">
                      {m.review.findings.map(f => (
                        <li key={`${f.issue}-${f.location ?? ''}`} className="rounded-lg bg-muted/40 p-3 text-sm">
                          <p className="font-medium">{f.issue}</p>
                          {f.location && <p className="mt-1 text-xs text-muted-foreground">{f.location}</p>}
                          {f.fix && <p className="mt-2">{f.fix}</p>}
                        </li>
                      ))}
                    </ul>
                  )
                : null}
              {reviewHref && <Link href={reviewHref} className={`${buttonVariants({ variant: 'outline' })} mt-4`}>{ask?.status === 'open' ? 'Review draft & give feedback' : 'View sign-off'}</Link>}
            </section>
            <section className="rounded-xl border p-5">
              <h2 className="text-base font-semibold">Feedback</h2>
              {m.feedback?.length
                ? (
                    <ol className="mt-4 space-y-4">
                      {m.feedback.map((f, i) => (
                        <li key={`${f.at}-${i}`} className="border-l-2 border-border pl-4">
                          <p className="text-sm whitespace-pre-wrap">{f.note}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {f.at ? new Date(f.at).toLocaleDateString() : ''}
                            {f.scope ? ` · ${f.scope}` : ''}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )
                : <p className="mt-2 text-sm text-muted-foreground">No feedback recorded yet.</p>}
            </section>
          </div>
        ) },
        { id: 'history', label: 'History', content: (
          <section>
            <h2 className="text-base font-semibold">Page history</h2>
            <p className="mt-2 mb-4 text-sm text-muted-foreground">Record changes appear here. Draft versions are available in the draft editor’s version menu.</p>
            <RecordHistory objectId={objectId} />
          </section>
        ) },
      ]}
      aside={(
        <>
          <SeoPublicationPanel key={objectId} pageId={objectId} projectId={m.projectId} expectedTitle={m.metaTitle?.trim() || title} publishedUrl={m.publishedUrl} publishedAt={m.publishedAt} providerPublished={m.status === 'published'} canVerify={canVerify} initial={m.publicationVerification} />
          <section className="rounded-xl border border-border p-5">
            <h2 className="mb-4 text-sm font-semibold">Publishing details</h2>
            <FactList
              layout="column"
              facts={[
                { label: 'Keyword', value: m.keyword || 'Not set' },
                { label: 'Client', value: m.projectName || 'Not named' },
                { label: 'Author', value: author?.name
                  ? (
                      <span>
                        {author.name}
                        {author.title && <span className="block text-xs text-muted-foreground">{author.title}</span>}
                      </span>
                    )
                  : 'Not assigned' },
                { label: 'Target', value: <span className="break-all">{m.target || m.slug || 'Not set'}</span> },
                { label: 'Meta title', value: m.metaTitle || 'Not set' },
                { label: 'Meta description', value: m.metaDescription || 'Not set' },
              ]}
            />
          </section>
          <section className="rounded-xl border border-border bg-muted/20 p-5">
            <h2 className="text-sm font-semibold">Sign-off</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Approval applies to the exact draft reviewed. Changes require a new sign-off before publishing.</p>
            {reviewHref ? <Link href={reviewHref} className={`${buttonVariants({ variant: 'outline' })} mt-4 w-full`}>{ask?.status === 'open' ? 'Review draft' : 'View sign-off'}</Link> : <p className="mt-3 text-sm text-muted-foreground">No sign-off is available for this page yet.</p>}
          </section>
        </>
      )}
    />
  );
}
