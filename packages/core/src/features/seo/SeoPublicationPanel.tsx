'use client';

import type { PublicationVerification } from '@/services/seo/publicationEvidence';
import { useState, useTransition } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { useRouter } from '@/libs/I18nNavigation';
import { isCurrentPublicationVerification } from '@/services/seo/publicationEvidence';

/**
 * A provider receipt and a public identity check are separate kinds of evidence.
 * @param root0
 * @param root0.projectId
 * @param root0.expectedTitle
 * @param root0.pageId
 * @param root0.publishedUrl
 * @param root0.publishedAt
 * @param root0.providerPublished
 * @param root0.canVerify
 * @param root0.initial
 */
export function SeoPublicationPanel({ pageId, projectId, expectedTitle, publishedUrl, publishedAt, providerPublished, canVerify, initial }: {
  pageId: number;
  projectId?: number;
  expectedTitle: string;
  publishedUrl?: string;
  publishedAt?: string;
  providerPublished: boolean;
  canVerify: boolean;
  initial?: PublicationVerification;
}) {
  const router = useRouter();
  const [check, setCheck] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const current = isCurrentPublicationVerification(check, { projectId, expectedTitle, publishedUrl, publishedAt, status: providerPublished ? 'published' : undefined });
  const safeUrl = publishedUrl && /^https?:\/\//i.test(publishedUrl) ? publishedUrl : null;
  const verify = () => start(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/v1/seo/pages/${pageId}/verify-publication`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error?.message || 'Publication check could not be recorded.');
      }
      setCheck(body as PublicationVerification);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publication check could not be recorded.');
    }
  });
  return (
    <section className="rounded-xl border border-border p-5" aria-label="Publication evidence">
      <h2 className="text-sm font-semibold">Publication evidence</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Publisher record</dt>
          <dd className="mt-1">
            {providerPublished ? 'Recorded as published' : 'Not recorded as published'}
            {providerPublished && publishedAt && <span className="mt-1 block text-xs text-muted-foreground">{publishedAt}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Public page check</dt>
          <dd className="mt-1 font-medium">{current ? check!.status === 'verified' ? 'Public HTML verified' : check!.status === 'failed' ? 'Public check failed' : 'Public availability unverified' : 'No current verification'}</dd>
        </div>
      </dl>
      {safeUrl && <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="mt-3 block text-xs break-all underline underline-offset-2">Open published URL</a>}
      {check && (
        <div className="mt-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground">
          {!current && <p className="mb-2 font-medium">Previous check does not verify the current publication.</p>}
          <p>{check.evidence}</p>
          <p className="mt-2">{`Checked: ${check.checkedAt}`}</p>
          {check.httpStatus && <p>{`HTTP ${check.httpStatus}`}</p>}
        </div>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Verification reads the saved public URL and checks its HTML identity. It does not publish, prove indexing, or monitor continuously.</p>
      {canVerify && providerPublished && publishedUrl
        ? <button type="button" disabled={busy} onClick={verify} className={`${buttonVariants({ variant: 'outline', size: 'sm' })} mt-4 w-full`}>{busy ? 'Checking public page…' : 'Verify public page'}</button>
        : providerPublished && <p className="mt-3 text-xs text-muted-foreground">{publishedUrl ? 'The client strategy owner can verify the saved published URL.' : 'No published URL is recorded. Publication must record its URL before a public check can run.'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
