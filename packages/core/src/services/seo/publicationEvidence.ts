/** Identity and receipt produced by the public HTML verifier. Legacy receipts lack identity. */
export type PublicationVerification = {
  status: 'verified' | 'unverified' | 'failed';
  checkedAt: string;
  url: string;
  finalUrl?: string;
  httpStatus?: number;
  evidence: string;
  identity?: { projectId: number; publishedAt: string | null; expectedTitle: string };
};

type PublicationIdentity = {
  projectId?: unknown;
  publishedUrl?: unknown;
  publishedAt?: unknown;
  expectedTitle: string;
  status?: unknown;
};

/**
 * A receipt only applies to the exact client, publication and title checked, not full content.
 * @param check
 * @param page
 * @param now
 */
export function isCurrentPublicationVerification(check: PublicationVerification | undefined, page: PublicationIdentity, now = new Date()): boolean {
  const identity = check?.identity;
  const checkedAt = check ? Date.parse(check.checkedAt) : Number.NaN;
  const publishedAt = typeof page.publishedAt === 'string' ? Date.parse(page.publishedAt) : Number.NaN;
  return Boolean(check && identity && page.status === 'published'
    && typeof page.projectId === 'number' && identity.projectId === page.projectId
    && identity.publishedAt === (page.publishedAt ?? null)
    && identity.expectedTitle === page.expectedTitle
    && typeof page.publishedUrl === 'string' && check.url === page.publishedUrl
    && Number.isFinite(checkedAt) && checkedAt <= now.getTime()
    && (page.publishedAt === undefined || (Number.isFinite(publishedAt) && publishedAt <= checkedAt)));
}
