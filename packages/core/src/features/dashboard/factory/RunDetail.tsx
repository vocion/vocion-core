'use client';

import type { PreviewDoc } from '@/libs/preview/types';
import { PreviewPane } from '@/features/preview/PreviewPane';
import { useRouter } from '@/libs/I18nNavigation';

/**
 * One engineering run, full width: the preview a Runs row opens, with its
 * close control going back to the list.
 * @param props
 * @param props.doc - The resolved run preview.
 * @param props.backHref - The Runs list.
 */
export function RunDetail({ doc, backHref }: { doc: PreviewDoc; backHref: string }) {
  const router = useRouter();
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col rounded-lg border border-border" data-testid="run-detail">
      <PreviewPane recordRef={doc.ref} doc={{ ...doc, href: undefined }} back backLabel="Back to runs" onClose={() => router.push(backHref)} />
    </div>
  );
}
