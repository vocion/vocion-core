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
 * artifact row passed through. No email, no internal link but one (the
 * "Open in <workspace>" button's `openUrl`, which the sharer can turn off),
 * no run log, no code, no pull request, no per-agent cost, no other record;
 * the workspace and product by display name only. Every picture
 * and the recording are served through the share token, by a URL the page
 * signed for that one file (`mediaSrc`); a file the page did not choose is
 * not reachable through the link.
 *
 * Pure: the loader that reads the tables is `featureShareData.ts`.
 */

import type { FeatureReport, HistoryRow } from './featureReport';
import type { Phase } from '@/libs/factory/featureGlance';
import { cardDescription, cardTitle, compactSpan, DEFAULT_BUILDER, DEFAULT_SITE_NAME, timeSplit } from '@/libs/factory/featureGlance';
import { readRequestLive } from '@/libs/factory/liveCheck';
import { showsAnError } from '@/libs/factory/mockup';
import { API_ARTIFACTS_BASE } from '@/libs/tools/artifacts/url';
import { shotParts } from '@/libs/workspace/criterionEvidence';
import { firstSentence } from '@/libs/workspace/releaseFeed';
import { money, RECORDING_ROLES } from './featureReport';

/** The role the public link is filed under on its request. */
export const FEATURE_PAGE_ROLE = 'public-page';
/** The parts of the page a sharer can leave out: who asked, and the button back into the workspace. */
export const HIDE_ASKER = 'asker';
export const HIDE_OPEN_LINK = 'open-link';
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
  /** The record it is filed on, when the loader read it (the attempt a QA shot belongs to). */
  recordId?: string | null;
  createdAt: Date;
  shareAudience: string;
};

/** The QA role a screenshot of the change is filed under, on the attempt that took it. */
export const QA_SHOT_ROLE = 'qa-screenshot';
/** The most QA screenshots the page shows: the evidence, not the whole QA record. */
const MAX_QA_SHOTS = 8;

/** One slide in the page's carousel, in the order it is shown. */
export type PublicSlide
  = | { kind: 'image'; src: string; label: 'Mockup' | 'Before' | 'After' | 'QA after' | 'QA before'; alt: string; caption: string | null; width?: number; height?: number }
    | {
      kind: 'video';
      src: string;
      type: string;
      label: string;
      caption: string;
      /**
       * The second the still frame is taken at (walk 20): a recording's first frame is a blank
       * page before anything loaded, so the preview shows the moment its first spoken line starts.
       */
      posterAt?: number;
    };

/** What a visitor sees. Every field is listed here; nothing else reaches the page. */
export type PublicFeaturePage = {
  /** The feature's ticket-sized name (`recordName`), never the whole ask. */
  title: string;
  /** The line under the name: "Shipped · 2 Oct 2026", or still being built. */
  status: { word: 'Shipped' | 'In progress'; at: string | null };
  /** Who built it: the workspace's own name, else {@link DEFAULT_BUILDER}. */
  builtBy: string;
  /** The workspace's display name (never its id or slug), or null when it cannot be read. */
  workspaceName: string | null;
  /** The product's display name, when the work names a product. */
  productName: string | null;
  /**
   * THE ONE LINK BACK IN (Chris, 2026-10-03: an "Open in <workspace>"
   * button): the feature's own page in the app, `/w/<slug>/…`, relative so it
   * opens on the address the page was opened at. A visitor without a session
   * signs in; one outside the workspace is refused there. Null when the
   * sharer turned it off. The only internal URL on the page.
   */
  openUrl: string | null;
  /**
   * The carousel, right under the name: the walkthrough first, then the
   * mockups (and the screen before, the shot after), then QA's screenshots
   * of the attempt that shipped. Every file through the share route.
   */
  media: PublicSlide[];
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
    /** "1h 12m" (`compactSpan`), or null when nothing is dated. */
    duration: string | null;
    /** What the duration runs to. */
    until: 'seen live' | 'shipped' | 'so far' | null;
    attempts: number | null;
    /** "$12.40" — the feature page's one total. Null when nothing is costed. */
    total: string | null;
    /** Builds, agents, chat: "not recorded" when that kind carries no cost. */
    split: Array<{ label: string; amount: string }>;
    /** Where the time went: Plan, Build, QA, Release, Live check — the ones that took any. */
    timeSplit: Array<{ label: string; amount: string }>;
  };
  /**
   * Oldest first: asked, planned, built, QA approved, merged, released, seen
   * live — each with how long until the next step and one plain sentence.
   */
  timeline: PublicStep[];
};

/** One step of the timeline. */
export type PublicStep = {
  step: string;
  /** ISO. The page shows it in the reader's clock. */
  at: string;
  /** "18 min" until the next step; null on the last. */
  took: string | null;
  /** What happened, in one fixed sentence per kind of step. */
  sentence: string;
};

/** The fields this module reads off the feature report. */
export type PublicFeatureReport = Pick<FeatureReport, 'title' | 'summary' | 'historyCost' | 'history' | 'release'> & { acceptance?: Pick<FeatureReport['acceptance'], 'attempt'> };

export type PublicFeatureInput = {
  report: PublicFeatureReport;
  request: { title: string; createdAt: Date | null; meta: Record<string, unknown> };
  /** The artifacts named by the request's visuals, read by id. */
  pictures: readonly SharedArtifact[];
  /** Recording candidates on the request and its tasks. */
  recordings: readonly SharedArtifact[];
  /** QA screenshots on the request's tasks; the page shows the shipped attempt's. */
  evidence?: readonly SharedArtifact[];
  /** The feature's name when the loader read one now (`nameOnRead`); else the report's. */
  name?: string;
  /** The feature's own code ("FE-402"), for the player's frame label. */
  code?: string | null;
  /** The workspace's display name (its project row), for "Built by …". */
  workspaceName?: string | null;
  /** The feature's page in the app (`recordHref`), unless the sharer hid the button. */
  openUrl?: string | null;
  /** The product record's display name, when the work names a product. */
  productName?: string | null;
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
  // The feature demo first (Chris, 2026-10-03: "the happy path, end to end" for a product manager), narrated before silent.
  `${RECORDING_ROLES.demo}${NARRATED_SUFFIX}`,
  RECORDING_ROLES.demo,
  // Then the demo recorded from the branch before merge (backlog 058), until the live one exists.
  `${RECORDING_ROLES.preview}${NARRATED_SUFFIX}`,
  RECORDING_ROLES.preview,
  `${RECORDING_ROLES.live}${NARRATED_SUFFIX}`,
  `${RECORDING_ROLES.qa}${NARRATED_SUFFIX}`,
  RECORDING_ROLES.live,
  RECORDING_ROLES.qa,
] as const;

const WALKTHROUGH_LABEL: Record<string, string> = {
  [`${RECORDING_ROLES.demo}${NARRATED_SUFFIX}`]: 'Feature demo',
  [RECORDING_ROLES.demo]: 'Feature demo',
  [`${RECORDING_ROLES.preview}${NARRATED_SUFFIX}`]: 'Feature demo, before merge',
  [RECORDING_ROLES.preview]: 'Feature demo, before merge',
  [`${RECORDING_ROLES.live}${NARRATED_SUFFIX}`]: 'Walkthrough',
  [`${RECORDING_ROLES.qa}${NARRATED_SUFFIX}`]: 'Walkthrough',
  [RECORDING_ROLES.live]: 'On the live product',
  [RECORDING_ROLES.qa]: 'In the tests, before it merged',
};

/**
 * When the recording's first spoken line starts, in seconds — the moment the preview frame is
 * taken at — or null when the recording carries no script.
 * @param spec - The recording's spec (`script` as the narration placed it).
 */
export function posterAt(spec: Record<string, unknown>): number | null {
  const script = Array.isArray(spec.script) ? spec.script as Array<{ atMs?: unknown }> : [];
  const first = script.map(l => Number(l.atMs)).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)[0];
  return first === undefined ? null : Math.round(first) / 1000;
}

/**
 * The one recording the page plays: the newest of the best role there is,
 * and only one the page can actually play to a stranger — Vocion's own copy,
 * served through the link (Chris, 2026-10-03: one player, the page's own).
 * @param candidates - Recordings on the request and its tasks.
 */
export function walkthroughOf(candidates: readonly SharedArtifact[]): SharedArtifact | null {
  for (const role of WALKTHROUGH_ROLES) {
    const playable = candidates
      .filter(a => a.recordRole === role && a.shareAudience !== 'me' && (serveVia(a) === 'media' || serveVia(a) === 'file' || serveVia(a) === 'stored'))
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
 * WHAT EACH STEP MEANS, in one plain sentence (Chris, 2026-10-03: "on the
 * timeline, simplified timestamps, run time, and a little sentence
 * explaining"). Fixed words per kind of step — never a row's own title,
 * which can name a person, a pull request or a run.
 */
export const STEP_SENTENCE: Readonly<Record<string, string>> = {
  'Asked': 'The ask came in and was filed as a feature.',
  'Planned': 'The product manager wrote a plan for the change.',
  'Plan approved': 'The plan was approved, so building could start.',
  'Building': 'An engineer agent is building the change.',
  'Built': 'An engineer agent built the change and sent it for review.',
  'A build attempt failed': 'A build attempt did not pass its checks, so another was started.',
  'QA approved': 'QA checked the change against what was asked and approved it.',
  'QA asked for changes': 'QA found something missing and sent it back to be built again.',
  'Merged': 'The change was merged into the product\'s code.',
  'Deploying': 'The change is being deployed.',
  'Deployed': 'The change was deployed.',
  'A deploy failed': 'A deploy did not finish.',
  'Released': 'The change went out in a release.',
  'Seen live': 'QA opened the live product and saw it working.',
  'Checked live': 'QA checked the live product.',
};

/** The phase each step closes, for where the time went (`timeSplit`). */
const STEP_PHASE: Readonly<Record<string, Phase>> = {
  'Planned': 'plan',
  'Plan approved': 'plan',
  'Building': 'build',
  'Built': 'build',
  'A build attempt failed': 'build',
  'QA approved': 'qa',
  'QA asked for changes': 'qa',
  'Merged': 'release',
  'Deploying': 'release',
  'Deployed': 'release',
  'A deploy failed': 'release',
  'Released': 'release',
  'Seen live': 'live',
  'Checked live': 'live',
};

/**
 * A short span for the timeline: "under a minute", "18 min", "1 h 19 min", "2 d 4 h".
 * @param ms - The span.
 */
export function shortSpan(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (!Number.isFinite(ms) || min < 1) {
    return 'under a minute';
  }
  if (min < 60) {
    return `${min} min`;
  }
  const h = Math.floor(min / 60);
  if (h < 24) {
    return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
  }
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d` : `${d} d ${h % 24} h`;
}

/** Steps written this close together are ordered by the loop, not the clock. */
export const SAME_MOMENT_MS = 3 * 60_000;

/** The loop's order, for steps stamped within the same moment. */
const STEP_RANK: Readonly<Record<string, number>> = {
  'Asked': 0,
  'Planned': 10,
  'Plan approved': 11,
  'Building': 20,
  'A build attempt failed': 21,
  'Built': 22,
  'QA asked for changes': 30,
  'QA approved': 31,
  'Merged': 40,
  'Deploying': 50,
  'A deploy failed': 51,
  'Deployed': 52,
  'Released': 60,
  'Checked live': 70,
  'Seen live': 71,
};

/**
 * A step's own words where the fixed sentence would mislead: the live check's line ("Live check ·
 * Seen live: 6 of 6 states reached", or why it could not look), and a build attempt or deploy that
 * failed, in the words the row carries (an attempt that ran out of time is not one that "did not
 * pass its checks"; walk 20, FE-436). Workspace details are taken out. Null for every other step.
 * @param row - The history row.
 */
function ownWords(row: HistoryRow): string | null {
  if (row.kind === 'live') {
    const words = row.title.replace(/^Live check\s*·\s*/, '').trim();
    return words ? `${scrub(words).replace(/[.\s]+$/, '')}.` : null;
  }
  if ((row.kind === 'build' && row.tone === 'bad' && !row.live) || (row.kind === 'deploy' && !row.live && row.tone !== 'ok')) {
    const words = row.title.trim();
    return words ? `${scrub(words).replace(/[.\s]+$/, '')}.` : null;
  }
  return null;
}

/**
 * The steps, oldest first, each with its time, how long until the next one
 * and what it means: the person's ask, then the feature page's Timeline rows
 * said as fixed words. A row's own title can name a person or a pull
 * request; these words cannot.
 * @param history - The report's Timeline, newest first.
 * @param askedAt - When they asked.
 */
export function publicSteps(history: readonly HistoryRow[], askedAt: Date | null): PublicStep[] {
  const rows = history.flatMap(r => (r.kind === 'attempt' ? r.children ?? [] : [r]));
  const steps = rows
    .map(r => ({ step: stepOf(r), at: r.at, said: ownWords(r) }))
    .filter((s): s is { step: string; at: string; said: string | null } => s.step !== null && s.at !== null && !Number.isNaN(Date.parse(s.at)));
  if (askedAt) {
    steps.push({ step: 'Asked', at: askedAt.toISOString(), said: null });
  }
  // By time; two steps written within the same few minutes keep the loop's order (QA approves, then
  // the merge, then the deploy), because a verdict's row is stamped when its run ends, which can be
  // a minute after the merge it caused (walk 19, FE-432: "Merged 8:43, QA approved 8:44").
  const sorted = steps.sort((a, b) => {
    const dt = Date.parse(a.at) - Date.parse(b.at);
    return Math.abs(dt) < SAME_MOMENT_MS ? (STEP_RANK[a.step] ?? 50) - (STEP_RANK[b.step] ?? 50) || dt : dt;
  });
  return sorted.map((s, i) => {
    const next = sorted[i + 1];
    // THE LIVE STEP SAYS WHAT THE CHECK SAID (walk 19): "QA opened the live product and saw it
    // working" was fixed copy, and stood under a check that could not see the feature. The live
    // check's own line is the sentence; the fixed copy is only for a record written without one.
    return { step: s.step, at: s.at, took: next ? shortSpan(Date.parse(next.at) - Date.parse(s.at)) : null, sentence: s.said ?? STEP_SENTENCE[s.step] ?? '' };
  });
}

/** The attempt whose judgement counts, as the report reads it. */
type CountedAttempt = NonNullable<FeatureReport['acceptance']['attempt']>;

/**
 * QA's screenshots of the attempt that shipped — the one whose judgement
 * counts (`featureProof.countedAttempt`), when a release carried it or QA
 * approved it. The shot after the change first, the screen before it after;
 * a capture QA named as the app's error state stays in the QA record (the
 * feature page's own rule, `showsAnError`). Only files the share route can
 * serve, never one narrowed to "Only me".
 * @param candidates - QA screenshots on the request's tasks.
 * @param attempt - The attempt that counts.
 */
export function shippedEvidence(candidates: readonly SharedArtifact[], attempt: CountedAttempt | null | undefined): Array<{ artifact: SharedArtifact; label: 'QA after' | 'QA before' }> {
  if (!attempt || (attempt.why !== 'shipped' && attempt.verdict !== 'approve')) {
    return [];
  }
  return candidates
    .filter(a => a.recordRole === QA_SHOT_ROLE && a.recordId === String(attempt.taskId) && a.shareAudience !== 'me' && isPicture(a) && serveVia(a) !== null && !showsAnError({ title: a.title, spec: a.spec }))
    .map(a => ({ artifact: a, label: shotParts(a.title).side === 'before' ? 'QA before' as const : 'QA after' as const }))
    .sort((x, y) => Number(x.label === 'QA before') - Number(y.label === 'QA before') || x.artifact.createdAt.getTime() - y.artifact.createdAt.getTime() || x.artifact.id - y.artifact.id)
    .slice(0, MAX_QA_SHOTS);
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
    return { duration: compactSpan(seenAt.getTime() - askedAt.getTime()), until: 'seen live' };
  }
  if (report.summary.shippedAt) {
    return { duration: compactSpan(report.summary.shippedAt.getTime() - askedAt.getTime()), until: 'shipped' };
  }
  return { duration: report.summary.elapsed, until: report.summary.elapsed ? 'so far' : null };
}

/**
 * A picture's pixel size, when the file says it (`spec.width`, `spec.height`).
 * @param spec - The artifact's spec.
 */
function sizeOf(spec: Record<string, unknown>): { width?: number; height?: number } {
  const w = Number(spec.width);
  const h = Number(spec.height);
  return Number.isInteger(w) && w > 0 && Number.isInteger(h) && h > 0 ? { width: w, height: h } : {};
}

/** What a link unfurls to in a chat app: the name, what it built, and one picture. */
export type ShareCard = {
  /** The name, with how long and the cost when it fits (`cardTitle`). */
  title: string;
  /** "Built by Northwind in 1h 12m for $4.80 · <what it built>" (`cardDescription`). */
  description: string;
  /** The workspace's name, else "Vocion". */
  siteName: string;
  /** Absolute, served through the share link with no cookie; null when the page has no picture to lead with. */
  image: { url: string; width?: number; height?: number; alt: string } | null;
};

/**
 * THE LINK'S PREVIEW (Chris, 2026-10-03: share metadata for Slack unfurls).
 * The name (with how long and the cost when it fits), who built it, how long
 * and for what, then the one sentence of what it built — the same figures as
 * the page's own (`libs/factory/featureGlance.ts`) — and the first mockup, else
 * QA's first screenshot of the change, else no picture. The picture's URL is
 * the page's own share-route URL made absolute against the origin the
 * request came in on (never a configured public origin: a link pasted from
 * one address is fetched back from that address), so a chat app fetches the
 * real `image/*` bytes with no cookie; a picture kept inline (`data:`) is
 * decoded and served by that route, since an unfurler cannot read one.
 * @param page - The page.
 * @param origin - The request's origin.
 */
export function shareCard(page: Pick<PublicFeaturePage, 'title' | 'built' | 'media' | 'effort' | 'builtBy' | 'productName'>, origin: string): ShareCard {
  const images = page.media.filter((m): m is Extract<PublicSlide, { kind: 'image' }> => m.kind === 'image');
  const lead = images.find(m => m.label === 'Mockup') ?? images.find(m => m.label === 'QA after' || m.label === 'QA before') ?? null;
  return {
    title: cardTitle(page.title, page.effort),
    description: cardDescription(page.effort, page.builtBy, page.built, page.productName),
    siteName: page.builtBy === DEFAULT_BUILDER ? DEFAULT_SITE_NAME : page.builtBy,
    image: lead && lead.src.startsWith('/')
      ? { url: new URL(lead.src, origin).toString(), ...(lead.width && lead.height ? { width: lead.width, height: lead.height } : {}), alt: lead.caption ?? lead.alt }
      : null,
  };
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
  const caption = (a: SharedArtifact) => scrub(str(a.spec, 'caption') ?? a.title);
  const cost = report.historyCost;
  const label = recording ? WALKTHROUGH_LABEL[recording.recordRole ?? ''] ?? 'Walkthrough' : '';
  const title = scrub(input.name ?? report.title);
  const image = (artifact: SharedArtifact, l: Extract<PublicSlide, { kind: 'image' }>['label']): PublicSlide => ({
    kind: 'image',
    src: input.mediaSrc(artifact.id),
    label: l,
    alt: scrub(artifact.title),
    caption: str(artifact.spec, 'caption') ? scrub(str(artifact.spec, 'caption')!) : null,
    ...sizeOf(artifact.spec),
  });
  // THE CAROUSEL (Chris, 2026-10-03: "the walkthrough video as the primary
  // carousel item, with the mocks, then QA evidence"). One picture is shown
  // once, in its first place.
  const pictures = sharedPictures(meta, byId);
  const shown = new Set(pictures.map(p => p.artifact.id));
  const media: PublicSlide[] = [
    ...(recording === null
      ? []
      : [{ kind: 'video' as const, src: input.mediaSrc(recording.id), type: str(recording.spec, 'contentType') ?? 'video/webm', label, caption: caption(recording), ...(posterAt(recording.spec) !== null ? { posterAt: posterAt(recording.spec)! } : {}) }]),
    ...pictures.map(({ artifact, label: l }) => image(artifact, l)),
    ...shippedEvidence(input.evidence ?? [], report.acceptance?.attempt).filter(e => !shown.has(e.artifact.id)).map(({ artifact, label: l }) => image(artifact, l)),
  ];
  const shippedAt = report.summary.shippedAt;
  const timeline = publicSteps(report.history, report.summary.askedAt);
  return {
    title,
    builtBy: input.workspaceName?.trim() ? scrub(input.workspaceName.trim()) : DEFAULT_BUILDER,
    workspaceName: input.workspaceName?.trim() ? scrub(input.workspaceName.trim()) : null,
    productName: input.productName?.trim() ? scrub(input.productName.trim()) : null,
    // A workspace path and nothing else: never a link out, never a query.
    openUrl: input.openUrl && /^\/w\/[\w-]+\/[\w/-]+$/.test(input.openUrl) ? input.openUrl : null,
    status: shippedAt ? { word: 'Shipped', at: shippedAt.toISOString() } : { word: 'In progress', at: null },
    media,
    ask: { text: scrub(text), by, at: report.summary.askedAt?.toISOString() ?? null },
    built: scrub(firstSentence(builtFrom) ?? builtFrom),
    effort: {
      ...durationOf(report, meta),
      attempts: report.summary.attempts,
      total: cost.totalCents > 0 ? money(cost.totalCents) : null,
      split: cost.split.map(s => ({ label: s.label, amount: s.cents === null ? 'not recorded' : money(s.cents) })),
      timeSplit: timeSplit(timeline.map(t => ({ at: t.at, phase: STEP_PHASE[t.step] ?? null }))),
    },
    timeline,
  };
}
