/**
 * document Card — a paginated, print-ready document the agent wrote with
 * `render_document`, rendered the way it prints.
 *
 * Two surfaces, one artifact: the chat surface shows what it is (title,
 * sheet count, whether the last render-verify passed, the first sheet), the
 * artifact surface shows the document itself in a sandboxed frame with
 * select-to-talk. The `id` and `record` ride in through the card payload so a
 * selection knows which artifact it is about; a preview without a row (a
 * pending shell) simply has none.
 */

import type { DocumentSpec } from '../specs';
import { defineCard } from '@vocion/sdk';
import { z } from 'zod';
import { DocumentFrame, DocumentSummary } from '@/features/dashboard/artifacts/DocumentFrame';
import { documentSpecSchema } from '../specs';

export const DOCUMENT_SLUG = 'document';

/** The spec plus what the pane knows and the row does not: which artifact this is. */
const documentCardSchema = documentSpecSchema.extend({
  __artifactId: z.number().int().positive().optional(),
});
type DocumentCardData = z.infer<typeof documentCardSchema>;

export function DocumentCardView({ data, surface }: { data: DocumentCardData; surface: string }) {
  const title = data.title ?? 'Document';
  if (surface !== 'artifact') {
    return <DocumentSummary title={title} sheets={data.sheets} verification={data.verification} />;
  }
  const id = data.__artifactId;
  return (
    <DocumentFrame
      html={data.html}
      title={title}
      sheets={data.sheets}
      verification={data.verification}
      {...(id ? { record: { type: 'artifact', id: String(id), label: title, href: `/dashboard/artifacts/${id}` }, openHref: `/api/artifacts/${id}/document.html` } : {})}
    />
  );
}

export const documentCard = defineCard({
  slug: DOCUMENT_SLUG,
  name: 'Document',
  description: 'A paginated, print-ready HTML document (US-Letter sheets) — a proposal, a scope doc, a partnership update — rendered the way it prints, with its render-verify verdict.',
  surfaces: ['chat', 'artifact', 'workflow-run', 'review-queue', 'activity-feed'],
  dataSchema: documentCardSchema,
  Renderer: ({ data, surface }) => <DocumentCardView data={data as DocumentSpec & { __artifactId?: number }} surface={surface} />,
});
