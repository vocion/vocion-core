/**
 * EVERY PICTURE SAYS WHAT IT IS, WHERE IT SITS AND WHO MADE IT (Chris,
 * 2026-09-30: "in the carousel can I get captions and section/source for all
 * images that go in the feature detail page carousel?").
 *
 * Each image on a feature page's carousel carries three things, all read off
 * the records — never written after the fact from an agent's words:
 *
 *   - its CAPTION: what it shows, one line — the caption written when it was
 *     filed (a mockup's state line, a QA capture's flow), else the title;
 *   - its SECTION: Mockup, Today, Plan, QA before, QA after, Live, or
 *     Reported in chat — where it sits in the story;
 *   - its SOURCE: who or what made it and when — "Designer · drawn from the
 *     request · Sep 25", "QA · run 435 · after · Sep 26" — linked to the run,
 *     conversation or release it came from, so the claim is one move from its
 *     evidence (principle 10).
 *
 * Pure: the report hands in the records it already read.
 */

import type { ReportArtifact, ReportObject, ReportWorkerRun } from './featureReport';
import { nounCode } from '@/libs/codes';
import { LIVE_ROLE } from '@/libs/factory/liveCheck';

/** Where a picture sits in the story. One word each, the carousel's label. */
export const CAROUSEL_SECTIONS = {
  mockup: 'Mockup',
  today: 'Today',
  plan: 'Plan',
  qaBefore: 'QA before',
  qaAfter: 'QA after',
  live: 'Live',
  reported: 'Reported in chat',
} as const;
export type CarouselSection = typeof CAROUSEL_SECTIONS[keyof typeof CAROUSEL_SECTIONS];

/** What a source links to — a pointer the preview pane opens. */
export type SourceRef = { type: 'conversation' | 'mission_run' | 'worker_run' | 'object' | 'artifact'; id: string };

/** Who or what made a picture, and when: one line, and where it came from. */
export type EvidenceSource = { text: string; ref: SourceRef | null };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A date as a person reads it under a picture: "Sep 25".
 * @param at - When.
 */
export function shortDate(at: Date): string {
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
}

function bag(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * A page address as it reads under a picture: host and path, no scheme.
 * @param url - The address.
 */
export function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 80);
  } catch {
    return url.replace(/^https?:\/\//, '').slice(0, 80);
  }
}

/**
 * The line under a picture: what it shows. The caption written when it was
 * filed; a QA capture's is its flow line; else the artifact's own title.
 * @param a - The artifact.
 */
export function captionOf(a: Pick<ReportArtifact, 'title' | 'spec'>): string {
  return text(a.spec.caption) ?? text(bag(a.spec.source).state) ?? text(a.spec.description) ?? a.title;
}

/**
 * The run a QA capture came from: the one it names, else the engineering run
 * on the same record that was going when it was filed.
 * @param a - The capture.
 * @param runs - The work's engineering runs.
 */
export function runOfCapture(a: Pick<ReportArtifact, 'recordId' | 'spec' | 'createdAt'>, runs: readonly Pick<ReportWorkerRun, 'id' | 'input' | 'createdAt' | 'completedAt'>[]): number | null {
  const named = num(bag(a.spec.provenance).workerRunId) ?? num(a.spec.workerRunId) ?? num(a.spec.runId);
  if (named) {
    return named;
  }
  const recordId = num(a.recordId);
  if (!recordId) {
    return null;
  }
  const at = a.createdAt.getTime();
  const mine = runs
    .filter(r => r.createdAt instanceof Date && num(bag(bag(r.input).record).id) === recordId && r.createdAt.getTime() <= at && (!(r.completedAt instanceof Date) || r.completedAt.getTime() >= at - 60_000))
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  return mine[0]?.id ?? null;
}

/** What the source line is built from, per picture. */
export type SourceInput = {
  artifact: ReportArtifact;
  section: CarouselSection;
  runs: readonly ReportWorkerRun[];
  /** The releases that carried the work, newest last. */
  releases: readonly ReportObject[];
  /** The conversation the request was filed from, for a picture the person sent. */
  originConversationId?: number | null;
};

/**
 * Who made one picture, and when, and where to see where it came from.
 * @param input - The picture and the records around it.
 */
export function sourceOf(input: SourceInput): EvidenceSource {
  const { artifact: a, section } = input;
  const prov = bag(a.spec.provenance);
  const when = shortDate(a.createdAt);
  const by = a.author ?? null;
  const capturedFrom = text(a.spec.capturedFrom);
  const conversationId = num(prov.conversationId) ?? a.conversationId ?? null;
  const missionRunId = num(prov.missionRunId);
  const artifactRef: SourceRef = { type: 'artifact', id: String(a.id) };
  const line = (...parts: Array<string | null | undefined>) => parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' · ');

  if (a.recordRole === 'qa-screenshot') {
    const run = runOfCapture(a, input.runs);
    const side = section === CAROUSEL_SECTIONS.qaBefore ? 'before' : section === CAROUSEL_SECTIONS.qaAfter ? 'after' : null;
    return { text: line('QA', run ? `run ${run}` : null, side, when), ref: run ? { type: 'worker_run', id: String(run) } : artifactRef };
  }
  if (section === CAROUSEL_SECTIONS.reported) {
    const cid = conversationId ?? input.originConversationId ?? null;
    return { text: line(`Reported in chat by ${by ?? 'a person'}`, cid ? nounCode('conversation', cid) : null, when), ref: cid ? { type: 'conversation', id: String(cid) } : artifactRef };
  }
  if (section === CAROUSEL_SECTIONS.plan) {
    return { text: line(by ?? 'Vocion', 'drawn from the record', when), ref: artifactRef };
  }
  if (section === CAROUSEL_SECTIONS.mockup) {
    const base = num(prov.baseArtifactId) ?? num(bag(a.spec.source).baseArtifactId);
    const how = prov.drawnFrom === 'screen' || base ? `drawn on screenshot${base ? ` ${nounCode('artifact', base)}` : ''}` : a.spec.source ? 'drawn from the request' : 'filed on the request';
    const ref: SourceRef = missionRunId ? { type: 'mission_run', id: String(missionRunId) } : conversationId ? { type: 'conversation', id: String(conversationId) } : artifactRef;
    return { text: line(by ?? 'Designer', how, when), ref };
  }
  // QA's live check after a release: which release it checked, linked to it.
  if (a.recordRole === LIVE_ROLE) {
    const releaseId = num(prov.releaseId) ?? num(a.recordId);
    const release = input.releases.find(r => r.id === releaseId);
    const version = release ? text(release.meta.version) : null;
    return {
      text: line('QA', 'live check', releaseId ? `release ${version ?? `#${releaseId}`}` : null, capturedFrom ? pageLabel(capturedFrom) : null, when),
      ref: releaseId ? { type: 'object', id: String(releaseId) } : artifactRef,
    };
  }
  if (capturedFrom) {
    return { text: line('Live app capture', pageLabel(capturedFrom), when), ref: artifactRef };
  }
  if (section === CAROUSEL_SECTIONS.live) {
    const release = [...input.releases].sort((x, y) => (x.createdAt?.getTime() ?? 0) - (y.createdAt?.getTime() ?? 0)).at(-1);
    const version = release ? text(release.meta.version) : null;
    return {
      text: line(by ? `Captured by ${by}` : 'Capture of the live product', release ? `release ${version ?? `#${release.id}`}` : null, when),
      ref: release ? { type: 'object', id: String(release.id) } : artifactRef,
    };
  }
  return { text: line(by ? `Filed by ${by}` : 'Screenshot of the product today', when), ref: conversationId ? { type: 'conversation', id: String(conversationId) } : artifactRef };
}
