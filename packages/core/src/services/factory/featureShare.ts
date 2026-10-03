/**
 * A FEATURE'S PUBLIC PAGE (Chris, 2026-10-03): "I want to quickly see: the
 * initial ask text and by whom; what it built in a sentence; how long and
 * cost to build; mocks; video walkthrough; timeline of actions."
 *
 * The link IS an artifact — a `link` filed on the request under the role
 * `public-page`, shared with `anyone` — so it rides the one share mechanism
 * the platform has (`libs/share/artifactShareToken.ts`, `libs/share/audience.ts`):
 * a signed token naming the artifact, and an audience the public route
 * re-checks on every request. Stop sharing narrows the audience and every
 * copy of the link is a 404 on its next request; sharing again files a new
 * link, so an old copy never comes back. Who shared it and when is the
 * artifact's own author and version history.
 *
 * SAFE BY CONSTRUCTION. What a visitor sees is `PublicFeaturePage`, built
 * here from an explicit list of fields — never the report, the record or an
 * artifact row passed through. No email, no internal link, no run log, no
 * code, no pull request, no per-agent cost, no other record. Every picture
 * and the recording are served through the share token, by a URL the page
 * signed for that one file (`mediaSrc`); a file the page did not choose is
 * not reachable through the link.
 *
 * Pure: the loader that reads the tables is `featureShareData.ts`.
 */

import type { FeatureReport, HistoryRow } from './featureReport';
import { readRequestLive } from '@/libs/factory/liveCheck';
import { API_ARTIFACTS_BASE } from '@/libs/tools/artifacts/url';
import { firstSentence } from '@/libs/workspace/releaseFeed';
import { formatDuration, money, RECORDING_ROLES } from './featureReport';

/** The role the public link is filed under on its request. */
export const FEATURE_PAGE_ROLE = 'public-page';
/** The part of the page a sharer can leave out: who asked. */
export const HIDE_ASKER = 'asker';
/** A narrated cut of a recording is filed under its role plus this. */
export const NARRATED_SUFFIX = '-narrated';

/** An artifact as this module reads it: only what deciding and serving need. */
export type SharedArtifact = {
  id: number;
  kind: string;
  title: string;
  url: string | null;
  spec: Record<string, unknown>;
  recordRole: string | null;
  createdAt: Date;
  shareAudience: string;
};

/** What a visitor sees. Every field is listed here; nothing else reaches the page. */
export type PublicFeaturePage = {
  title: string;
  ask: {
    /** The request as the person typed it. */
    text: string;
    /** Their display name, or null when hidden or not recorded. Never an email. */
    by: string | null;
    /** ISO. */
    at: string | null;
  };
  /** What it built, in one sentence. */
  built: string;
  effort: {
    /** "2d 4h", or null when nothing is dated. */
    duration: string | null;
    /** What the duration runs to. */
    until: 'seen live' | 'shipped' | 'so far' | null;
    attempts: number | null;
    /** "$12.40" — the feature page's one total. Null when nothing is costed. */
    total: string | null;
    /** Builds, agents, chat: "not recorded" when that kind carries no cost. */
    split: Array<{ label: string; amount: string }>;
  };
  pictures: Array<{ src: string; label: 'Mockup' | 'Before' | 'After'; alt: string; caption: string | null }>;
  video:
    | { kind: 'embed'; src: string; label: string; caption: string; at: string }
    | { kind: 'file'; src: string; type: string; label: string; caption: string; at: string }
    | null;
  /** Oldest first: asked, planned, built, QA approved, merged, released, seen live. */
  timeline: Array<{ step: string; at: string }>;
};

/** The fields this module reads off the feature report. */
export type PublicFeatureReport = Pick<FeatureReport, 'title' | 'summary' | 'historyCost' | 'history' | 'release'>;

export type PublicFeatureInput = {
  report: PublicFeatureReport;
  request: { title: string; createdAt: Date | null; meta: Record<string, unknown> };
  /** The artifacts named by the request's visuals, read by id. */
  pictures: readonly SharedArtifact[];
  /** Recording candidates on the request and its tasks. */
  recordings: readonly SharedArtifact[];
  hideAsker: boolean;
  /** Where the page loads a file it chose from: the share route, signed for that file. */
  mediaSrc: (artifactId: number) => string;
};

function str(source: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = source?.[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function bag(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function ids(visuals: Record<string, unknown>, key: string): number[] {
  const raw = visuals[key];
  return Array.isArray(raw) ? raw.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LINK = /\bhttps?:\/\/\S+/gi;

/**
 * Text bound for a public page, with addresses taken out: an email becomes
 * "[email hidden]", a link "[link hidden]". This is redaction of what leaves
 * the workspace, not a reading of what the words mean — the words are kept.
 * @param text - Any free text from a record.
 */
export function scrub(text: string): string {
  return text.replace(EMAIL, '[email hidden]').replace(LINK, '[link hidden]');
}

/** How the share route can serve a file, or null when it cannot. */
export type ServeVia = 'media' | 'stored' | 'file' | 'data';

/**
 * How a file can be served through the share token: Vocion's media store, its
 * artifact store, a file artifact, or an inline picture. A link out to
 * somewhere else is not served — the page cannot vouch for it, and it may be
 * a signed URL into a private bucket.
 * @param a - The artifact.
 */
export function serveVia(a: Pick<SharedArtifact, 'kind' | 'url' | 'spec'>): ServeVia | null {
  const url = a.url ?? str(a.spec, 'url');
  if (url?.startsWith('/api/media/')) {
    return 'media';
  }
  if (url?.startsWith(`${API_ARTIFACTS_BASE}/`)) {
    return a.kind === 'file' ? 'file' : 'stored';
  }
  if (url && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(url)) {
    return 'data';
  }
  return a.kind === 'file' && url === null && str(a.spec, 'filename') ? 'file' : null;
}

function isPicture(a: SharedArtifact): boolean {
  const url = a.url ?? str(a.spec, 'url') ?? '';
  const type = str(a.spec, 'contentType');
  return (type !== null && type.startsWith('image/') && type !== 'image/svg+xml')
    || /^data:image\//i.test(url)
    || /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(url);
}

/**
 * The pictures the page shows, in order: the mockup, the screen it was drawn
 * on, and the after-shot — each read off the request's own visuals by id, the
 * same lists the feature page reads. A record written before mockups had
 * their own list kept them on `beforeArtifactIds`, so without mockups that
 * list is the proposal. Only pictures the share route can serve, and never
 * one narrowed to "Only me".
 * @param meta - The request's metadata.
 * @param byId - The artifacts named there.
 */
export function sharedPictures(meta: Record<string, unknown>, byId: ReadonlyMap<number, SharedArtifact>): Array<{ artifact: SharedArtifact; label: 'Mockup' | 'Before' | 'After' }> {
  const visuals = bag(meta.visuals);
  const mockups = ids(visuals, 'mockupArtifactIds');
  const before = ids(visuals, 'beforeArtifactIds');
  const wanted: Array<{ id: number; label: 'Mockup' | 'Before' | 'After' }> = [
    ...(mockups.length > 0 ? mockups : before).map(id => ({ id, label: 'Mockup' as const })),
    ...(mockups.length > 0 ? before : []).map(id => ({ id, label: 'Before' as const })),
    ...ids(visuals, 'afterArtifactIds').map(id => ({ id, label: 'After' as const })),
  ];
  const seen = new Set<number>();
  const out: Array<{ artifact: SharedArtifact; label: 'Mockup' | 'Before' | 'After' }> = [];
  for (const w of wanted) {
    const artifact = byId.get(w.id);
    if (!artifact || seen.has(w.id) || artifact.shareAudience === 'me' || !isPicture(artifact) || serveVia(artifact) === null) {
      continue;
    }
    seen.add(w.id);
    out.push({ artifact, label: w.label });
  }
  return out;
}

/** The roles a walkthrough is read from, best first: narrated, then the live check's, then the tests'. */
export const WALKTHROUGH_ROLES = [
  `${RECORDING_ROLES.live}${NARRATED_SUFFIX}`,
  `${RECORDING_ROLES.qa}${NARRATED_SUFFIX}`,
  RECORDING_ROLES.live,
  RECORDING_ROLES.qa,
] as const;

const WALKTHROUGH_LABEL: Record<string, string> = {
  [`${RECORDING_ROLES.live}${NARRATED_SUFFIX}`]: 'Walkthrough',
  [`${RECORDING_ROLES.qa}${NARRATED_SUFFIX}`]: 'Walkthrough',
  [RECORDING_ROLES.live]: 'On the live product',
  [RECORDING_ROLES.qa]: 'In the tests, before it merged',
};

/**
 * The video host's player, when the recording was published there for
 * anyone to watch (`spec.hostedVideo`). A recording shared with the team
 * only would show a stranger a sign-in wall, so it is played from Vocion's
 * own copy instead.
 * @param a - The recording.
 */
export function publicEmbed(a: Pick<SharedArtifact, 'spec'>): string | null {
  const hosted = bag(a.spec.hostedVideo);
  const embed = str(hosted, 'embedUrl');
  return hosted.state === 'published' && hosted.visibility === 'public' && embed !== null && /^https:\/\//i.test(embed) ? embed : null;
}

/**
 * The one recording the page plays: the newest of the best role there is,
 * and only one the page can actually play to a stranger.
 * @param candidates - Recordings on the request and its tasks.
 */
export function walkthroughOf(candidates: readonly SharedArtifact[]): SharedArtifact | null {
  for (const role of WALKTHROUGH_ROLES) {
    const playable = candidates
      .filter(a => a.recordRole === role && a.shareAudience !== 'me' && (publicEmbed(a) !== null || serveVia(a) === 'media' || serveVia(a) === 'file' || serveVia(a) === 'stored'))
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || y.id - x.id);
    if (playable[0]) {
      return playable[0];
    }
  }
  return null;
}

/**
 * A Timeline row in the words a visitor reads, or null for a row that stays inside.
 * @param row
 */
function stepOf(row: HistoryRow): string | null {
  switch (row.kind) {
    case 'plan':
      return row.tone === 'ok' && row.key.startsWith('plan-approved-') ? 'Plan approved' : 'Planned';
    case 'build':
      return row.live ? 'Building' : row.tone === 'ok' ? 'Built' : row.tone === 'bad' ? 'A build attempt failed' : null;
    case 'review':
      return row.tone === 'ok' ? 'QA approved' : row.tone === 'warn' ? 'QA asked for changes' : null;
    case 'merge':
      return 'Merged';
    case 'deploy':
      return row.live ? 'Deploying' : row.tone === 'ok' ? 'Deployed' : 'A deploy failed';
    case 'release':
      return 'Released';
    case 'live':
      return row.tone === 'ok' ? 'Seen live' : 'Checked live';
    // Conversations, other agent runs and the factory's own notes are the
    // workings, not the story — and carry titles written for the team.
    default:
      return null;
  }
}

/**
 * The steps, oldest first, each with its time: the person's ask, then the
 * feature page's Timeline rows said as fixed words. A row's own title can
 * name a person or a pull request; these words cannot.
 * @param history - The report's Timeline, newest first.
 * @param askedAt - When they asked.
 */
export function publicSteps(history: readonly HistoryRow[], askedAt: Date | null): PublicFeaturePage['timeline'] {
  const rows = history.flatMap(r => (r.kind === 'attempt' ? r.children ?? [] : [r]));
  const steps = rows
    .map(r => ({ step: stepOf(r), at: r.at }))
    .filter((s): s is { step: string; at: string } => s.step !== null && s.at !== null && !Number.isNaN(Date.parse(s.at)));
  if (askedAt) {
    steps.push({ step: 'Asked', at: askedAt.toISOString() });
  }
  return steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/**
 * How long it took: from the ask to when QA saw it live, else to the first
 * release, else so far.
 * @param report - The report.
 * @param meta - The request's metadata, for when the live check saw it.
 */
function durationOf(report: PublicFeatureReport, meta: Record<string, unknown>): Pick<PublicFeaturePage['effort'], 'duration' | 'until'> {
  const askedAt = report.summary.askedAt;
  if (!askedAt) {
    return { duration: null, until: null };
  }
  const live = readRequestLive(meta);
  const seenAt = report.release.state === 'live' && live?.state === 'seen' && live.checkedAt ? new Date(live.checkedAt) : null;
  if (seenAt && !Number.isNaN(seenAt.getTime()) && seenAt.getTime() >= askedAt.getTime()) {
    return { duration: formatDuration(seenAt.getTime() - askedAt.getTime()), until: 'seen live' };
  }
  if (report.summary.shippedAt) {
    return { duration: formatDuration(report.summary.shippedAt.getTime() - askedAt.getTime()), until: 'shipped' };
  }
  return { duration: report.summary.elapsed, until: report.summary.elapsed ? 'so far' : null };
}

/**
 * The page a visitor sees, from the report and the request — only the fields
 * `PublicFeaturePage` lists.
 * @param input - The report, the request, the files it may show and how to reach them.
 */
export function publicFeaturePage(input: PublicFeatureInput): PublicFeaturePage {
  const { report, request } = input;
  const meta = request.meta;
  const askedBy = bag(meta.askedBy);
  const name = str(askedBy, 'name');
  const by = input.hideAsker || name === null || name.includes('@') ? null : scrub(name);
  const text = str(meta, 'body') ?? request.title;
  const builtFrom = str(meta, 'outcome') ?? str(meta, 'summary') ?? report.title;
  const byId = new Map(input.pictures.map(a => [a.id, a]));
  const recording = walkthroughOf(input.recordings);
  const embed = recording ? publicEmbed(recording) : null;
  const caption = (a: SharedArtifact) => scrub(str(a.spec, 'caption') ?? a.title);
  const cost = report.historyCost;
  return {
    title: scrub(report.title),
    ask: { text: scrub(text), by, at: report.summary.askedAt?.toISOString() ?? null },
    built: scrub(firstSentence(builtFrom) ?? builtFrom),
    effort: {
      ...durationOf(report, meta),
      attempts: report.summary.attempts,
      total: cost.totalCents > 0 ? money(cost.totalCents) : null,
      split: cost.split.map(s => ({ label: s.label, amount: s.cents === null ? 'not recorded' : money(s.cents) })),
    },
    pictures: sharedPictures(meta, byId).map(({ artifact, label }) => ({
      src: input.mediaSrc(artifact.id),
      label,
      alt: scrub(artifact.title),
      caption: str(artifact.spec, 'caption') ? scrub(str(artifact.spec, 'caption')!) : null,
    })),
    video: recording === null
      ? null
      : embed
        ? { kind: 'embed', src: embed, label: WALKTHROUGH_LABEL[recording.recordRole ?? ''] ?? 'Walkthrough', caption: caption(recording), at: recording.createdAt.toISOString() }
        : { kind: 'file', src: input.mediaSrc(recording.id), type: str(recording.spec, 'contentType') ?? 'video/webm', label: WALKTHROUGH_LABEL[recording.recordRole ?? ''] ?? 'Walkthrough', caption: caption(recording), at: recording.createdAt.toISOString() },
    timeline: publicSteps(report.history, report.summary.askedAt),
  };
}
