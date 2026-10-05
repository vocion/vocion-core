/**
 * THE DEMO ON THE MERGE CARD (backlog 058; Chris, 2026-10-04: "the demo video
 * to share with the requester at merge approval time, so they would have more
 * context and trust to approve"). The runner's QA pass records the feature
 * from the branch before merge and files it on the request as
 * `feature-demo-preview`; QA narrates it. The merge card plays the newest
 * one, narrated when the narration is done, so the approval is of something
 * seen working rather than of a verdict's word.
 */
import type { ReviewContent } from '@/libs/actions/types';
import { DEMO_PREVIEW_VIDEO_ROLE } from '@/libs/factory/liveCheck';
import { posterSecond } from '@/libs/media/narration';
import { narratedRole } from '@/libs/media/roles';

/** What the picker reads off an artifact row. */
export type DemoCandidate = { id: number; recordRole: string | null; spec: unknown; createdAt: Date };

/** The recording the card plays. */
export type PreviewDemo = { artifactId: number; url: string; contentType: string; caption: string; narrated: boolean; posterAt: number | null };

function str(spec: unknown, key: string): string | null {
  const v = (spec && typeof spec === 'object' ? (spec as Record<string, unknown>)[key] : undefined);
  return typeof v === 'string' && v ? v : null;
}

/**
 * When the first said line starts, in seconds — the frame the player shows before play.
 * @param spec - The recording's spec.
 */
function firstLineAt(spec: unknown): number | null {
  return posterSecond(spec && typeof spec === 'object' ? spec as Record<string, unknown> : null);
}

/**
 * The newest preview demo among a request's artifacts: its narrated version
 * when one exists, else the recording itself; only one Vocion serves (its
 * media route), which is the only one a card can play.
 * @param artifacts - The request's artifacts.
 */
export function pickPreviewDemo(artifacts: readonly DemoCandidate[]): PreviewDemo | null {
  const playable = (role: string) => artifacts
    .filter(a => a.recordRole === role)
    .map(a => ({ a, url: str(a.spec, 'url') }))
    .filter((x): x is { a: DemoCandidate; url: string } => x.url !== null && x.url.startsWith('/api/media/'))
    .sort((x, y) => y.a.createdAt.getTime() - x.a.createdAt.getTime() || y.a.id - x.a.id)[0] ?? null;
  const narrated = playable(narratedRole(DEMO_PREVIEW_VIDEO_ROLE));
  const plain = playable(DEMO_PREVIEW_VIDEO_ROLE);
  const top = narrated ?? plain;
  if (!top) {
    return null;
  }
  return {
    artifactId: top.a.id,
    url: top.url,
    contentType: str(top.a.spec, 'contentType') ?? (top === narrated ? 'video/mp4' : 'video/webm'),
    caption: str(top.a.spec, 'caption') ?? 'Feature demo, built from the branch',
    narrated: top === narrated,
    posterAt: firstLineAt(top.a.spec),
  };
}

/**
 * The card item for a preview demo.
 * @param demo - The picked recording.
 */
export function previewDemoContent(demo: PreviewDemo): ReviewContent {
  return {
    kind: 'video',
    id: 'demo',
    label: 'Feature demo, built from the branch',
    tabLabel: 'Demo',
    url: demo.url,
    contentType: demo.contentType,
    caption: `${demo.caption}${demo.narrated ? '' : ' · narration on its way'}`,
    ...(demo.posterAt !== null ? { posterAt: demo.posterAt } : {}),
  };
}

/**
 * The preview demo of the request an engineering task belongs to, as a card
 * item — or nothing, when none was recorded or the task names no request.
 * Resolved when the card is read, so a narration finished after the card was
 * filed still plays. Never throws: a card must never fall over its evidence.
 * @param orgId - The workspace.
 * @param taskId - The engineering task the merge closes.
 */
export async function previewDemoForTask(orgId: string, taskId: number): Promise<ReviewContent | null> {
  try {
    const { db } = await import('@/libs/DB');
    const { and, eq } = await import('drizzle-orm');
    const { businessObjectSchema } = await import('@/models/Schema');
    const [task] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, taskId))).limit(1);
    const requestId = Number((task?.meta as Record<string, unknown> | null)?.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return null;
    }
    const { listArtifactsForRecord } = await import('@/services/ArtifactService');
    const rows = await listArtifactsForRecord({ orgId, record: { type: 'object', id: String(requestId) } });
    const demo = pickPreviewDemo(rows.map(r => ({ id: r.id, recordRole: r.recordRole, spec: r.spec, createdAt: r.createdAt })));
    return demo ? previewDemoContent(demo) : null;
  } catch {
    return null;
  }
}
