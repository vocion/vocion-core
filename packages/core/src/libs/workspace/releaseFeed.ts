import type { PageRow } from './pageFields';
import type { RecordLinker } from './recordHref';
import { dayDistance, dayKey, formatDate, formatTime } from '@/libs/time/zone';
import { relativeLabel } from '@/libs/timeAgo';
import { featureProof, risksLine } from './featureProof';
import { genericRecordLinker } from './recordHref';
import { hoursLive, SOAK_HOURS } from './releaseOutcome';

/**
 * WHAT A RELEASE MEANS TO THE PERSON READING IT.
 *
 * A release record is written by a deploy script: a title like
 * `send 930a23f6ebbd`, the commit subjects since the last deploy, the pull
 * requests they name, a health flag, and a placeholder announcement. The
 * product owner reading the Releases page asks four other questions — what
 * changed for users, is it live and did verification pass, does anything need
 * me, who should hear about it — and none of them is answered by a sha.
 *
 * This file is the one reading of a release, pure so it can be argued with in
 * a test: the Releases feed (`derive: releaseFeed`) and the release's own page
 * (`services/factory/releaseReport.ts`) both read through it, so a row and its
 * page can never disagree about what shipped.
 *
 * What the data supports, and what it does not:
 *
 * - A release's notes are a REPOSITORY's commits, and the repository can hold
 *   more than the product (Stamp's monorepo carries the factory worker beside
 *   the app). The record carries commit SUBJECTS, not file paths, so a change
 *   is judged internal by its conventional-commit type and scope —
 *   `fix(worker): …`, `ci: …`, `feat(deploy): …`. A subject with no prefix is
 *   read as a product change, because hiding a real change is worse than
 *   showing a technical one.
 * - Releases from before one-release-per-deploy were written once per
 *   SURFACE (`surface: web`) and carry no `surfaces` list. They read as
 *   deployments of one surface. They are not grouped into releases: two rows
 *   sharing a commit may or may not have gone out together, and a shared
 *   commit alone does not prove it.
 */

/** The line the deploy script writes where an announcement should be. It is "not prepared", never content. */
export const ANNOUNCEMENT_PLACEHOLDER = 'Announcement not written yet. A person replaces this line.';

/** Conventional-commit types that never change what a person using the product sees. */
const INTERNAL_TYPES = new Set(['ci', 'chore', 'build', 'test', 'tests', 'style', 'refactor', 'docs', 'deps', 'infra']);
/**
 * Scopes that name the machinery around a product rather than the product:
 * the factory worker that builds it, the pipeline that deploys it.
 */
const INTERNAL_SCOPES = new Set(['worker', 'factory', 'deploy', 'ci', 'build', 'infra', 'deps', 'tooling', 'tests', 'intake', 'scripts']);

export type CommitKind = 'improvement' | 'fix' | 'internal' | 'revert' | 'reverted';

export type ReleaseCommit = {
  sha: string | null;
  /** The subject as the repository wrote it. */
  subject: string;
  /** The subject a person reads: no type prefix, no PR number, sentence case. */
  plain: string;
  type: string | null;
  scope: string | null;
  kind: CommitKind;
  /** The pull request the subject names at its end — `(#96)`. */
  pr: number | null;
  /** For an internal change, what it touched — `worker`, `deploy`, `ci`. */
  area: string | null;
};

/** A record the release links to, with only the fields the reading uses. */
export type LinkedRecord = { id: number; type: string; title: string; meta: Record<string, unknown> };

export type ReleaseLinked = {
  /** Tasks and requests by id. */
  records: Map<number, LinkedRecord>;
  /** Product slug → the product's own name. */
  products: Map<string, string>;
  /**
   * Where a record opens in this workspace (`libs/workspace/recordHref.ts`).
   * Absent, every record opens the generic view.
   */
  link?: RecordLinker;
};

export const NO_LINKS: ReleaseLinked = { records: new Map(), products: new Map() };

/**
 * QA's verdict on a shipped feature. `proven`/`total` count the work's own
 * acceptance lines and `risksHandled`/`risksTotal` the plan-risk lines, both
 * from `featureProof` — the count the feature's page shows too.
 */
export type FeatureVerdict = { value: string | null; proven: number | null; total: number | null; risksHandled: number | null; risksTotal: number | null; at: string | null; by: string | null };

export type ReleaseFeature = {
  requestId: number | null;
  taskIds: number[];
  title: string;
  /** What a person can do now, in one sentence. */
  outcome: string | null;
  kind: 'improvement' | 'fix';
  verdict: FeatureVerdict | null;
  prNumbers: number[];
  /** The feature's own page. */
  href: string;
};

export type ReleaseKind = 'release' | 'deployment';

export type AnnouncementState = 'published' | 'approved' | 'draft' | 'not-prepared' | 'not-needed';

export type ReleaseAnnouncement = {
  state: AnnouncementState;
  label: 'Published' | 'Approved' | 'Draft ready' | 'Not prepared' | 'Not needed';
  /** The words, when a person or the agent has written some. Never the placeholder. */
  text: string | null;
  /** Why no announcement is needed, when none is. */
  reason: string | null;
  publishedAt: Date | null;
  channels: string[];
};

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export type ReleaseVerification = {
  state: 'verified' | 'issue' | 'missing';
  label: 'Verified' | 'Issue detected' | 'Verification missing';
  /** Feature acceptance: QA's verdict on each shipped feature. Null when the release carried no feature. */
  acceptance: { state: 'passed' | 'failed' | 'missing'; line: string } | null;
  /** Post-deploy verification: did the deploy work. */
  health: { value: 'ok' | 'degraded' | 'down' | 'unknown' | null; line: string; tone: Tone; checkedAt: Date | null; freshness: string | null };
  /** Product impact: did the change work. A different, later question. */
  impact: { state: 'helped' | 'regressed' | 'inconclusive' | 'pending' | 'unchecked' | 'none'; line: string; tone: Tone };
  /** The one line a feed row carries. */
  line: string;
};

export type ReleaseReading = {
  kind: ReleaseKind;
  productSlug: string | null;
  productName: string;
  surfaces: string[];
  version: string | null;
  versionShort: string | null;
  releasedAt: Date | null;
  headline: string;
  summary: string;
  commits: ReleaseCommit[];
  features: ReleaseFeature[];
  /** Product changes the deploy carried that no factory feature accounts for. */
  otherChanges: ReleaseCommit[];
  internal: ReleaseCommit[];
  /** Changes that went out and came back in the same deploy. */
  reverted: ReleaseCommit[];
  userFacing: boolean;
  counts: { improvements: number; fixes: number; internal: number; reverted: number };
  verification: ReleaseVerification;
  announcement: ReleaseAnnouncement;
  /** People who asked for something this shipped and have not been told. */
  waitingRequesters: LinkedRecord[];
  attention: string[];
};

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : Number.NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function date(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') {
    return null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

/** Words a commit subject writes in lower case that a person reads in capitals. */
const ACRONYMS = new Set(['qa', 'api', 'ui', 'ci', 'pr', 'url', 'pdf', 'sso', 'csv']);

function sentenceCase(s: string): string {
  const first = /^[a-z]+/.exec(s)?.[0];
  if (first && ACRONYMS.has(first)) {
    return first.toUpperCase() + s.slice(first.length);
  }
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The same subject read mid-sentence: "the export keeps accents".
 * @param s
 */
function midSentence(s: string): string {
  const first = /^[A-Z][a-z]+\b/.exec(s)?.[0];
  return first ? first.toLowerCase() + s.slice(first.length) : s;
}

/**
 * The first sentence of a passage — a task objective is a paragraph, and a
 * feed row carries one line.
 * @param text - The passage.
 */
export function firstSentence(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?:\s|$)/.exec(flat);
  return (m ? m[1]! : flat).trim() || null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function listOf(items: string[]): string {
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A pull request number from its URL — `…/pull/96` → 96.
 * @param url - The URL.
 */
export function prNumberOf(url: string): number | null {
  return num(/\/pull\/(\d+)/.exec(url)?.[1]);
}

/**
 * Whether an announcement is words a person could publish, rather than empty
 * or the deploy script's placeholder.
 * @param raw - `meta.announcement`.
 */
export function announcementText(raw: unknown): string | null {
  const text = str(raw);
  if (text === null) {
    return null;
  }
  return text.replace(/\s+/g, ' ') === ANNOUNCEMENT_PLACEHOLDER ? null : text;
}

/**
 * Words that belong on the release page and never in its announcement: QA's
 * counts, the criteria, pull request numbers, the plan's risks. The release
 * type's `announcement-in-plain-words` gate refuses an agent's draft that
 * matches (`objects/release/type.yaml`, the same pattern — a test holds them
 * equal), so the product manager rewrites it.
 */
export const ANNOUNCEMENT_INTERNAL = /QA|criteria|proven|PR #|\bplan risk/i;

/**
 * An announcement with its internal sentences taken out — for a draft written
 * before the gate refused them. Returns the sentences it dropped, so whoever
 * runs it can say what changed.
 * @param text - The drafted announcement.
 */
export function plainAnnouncement(text: string): { text: string; dropped: string[] } {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [];
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence) {
      (ANNOUNCEMENT_INTERNAL.test(sentence) ? dropped : kept).push(sentence);
    }
  }
  return { text: kept.join(' '), dropped };
}

// ---------------------------------------------------------------------------
// Commits
// ---------------------------------------------------------------------------

/**
 * One commit line, read. `930a23f logic: Uploads that survive a bad
 * connection (#96)` is a product improvement from PR 96;
 * `afae194 fix(worker): …` is internal, because it changed the factory worker
 * and nothing a person using the product sees.
 * @param line - A `git log --oneline` line, or a bare subject.
 */
export function parseCommit(line: string): ReleaseCommit {
  const trimmed = line.trim().replace(/^[-*]\s+/, '');
  const shaMatch = /^([0-9a-f]{7,40})\s+(\S.*)$/.exec(trimmed);
  const sha = shaMatch ? shaMatch[1]! : null;
  const subject = shaMatch ? shaMatch[2]!.trim() : trimmed;
  const cc = /^([a-z]+)(?:\(([^)]+)\))?!?:\s*(\S.*)$/i.exec(subject);
  const type = cc ? cc[1]!.toLowerCase() : null;
  const scope = cc?.[2] ? cc[2].toLowerCase() : null;
  let rest = cc ? cc[3]! : subject;
  const pr = num(/\(#(\d+)\)\s*$/.exec(rest)?.[1]);
  if (type === 'revert') {
    // `revert: logic: find a document (#66), merged by mistake (#68)` reads
    // as the thing that was reverted.
    rest = rest.replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, '').replace(/\s*\(#\d+\).*$/, '');
  }
  const plain = sentenceCase(rest.replace(/\s*\(#\d+\)\s*$/, '').trim());
  let kind: CommitKind;
  let area: string | null = null;
  if (type === 'revert') {
    kind = 'revert';
  } else if ((type !== null && INTERNAL_TYPES.has(type)) || (scope !== null && INTERNAL_SCOPES.has(scope))) {
    kind = 'internal';
    area = scope !== null && INTERNAL_SCOPES.has(scope) ? scope : type;
  } else if (type === 'fix') {
    kind = 'fix';
  } else {
    kind = 'improvement';
  }
  return { sha, subject, plain, type, scope, kind, pr, area };
}

/**
 * The pull request numbers a revert commit undid: every `#N` it names except
 * its own.
 * @param commit - A revert commit.
 */
function revertedBy(commit: ReleaseCommit): number[] {
  return [...commit.subject.matchAll(/#(\d+)/g)].map(m => Number(m[1])).filter(n => n !== commit.pr);
}

/**
 * Every commit a release carried, read, with the ones a revert in the same
 * deploy undid marked `reverted`. Older records carry no `commits` list; their
 * `notes` are the same subjects as a markdown list.
 * @param meta - The release's metadata.
 */
export function releaseCommits(meta: Record<string, unknown>): ReleaseCommit[] {
  const raw = Array.isArray(meta.commits) && meta.commits.length > 0
    ? meta.commits.map(String)
    : (str(meta.notes) ?? '').split('\n').filter(l => /^\s*[-*]\s+\S/.test(l)).filter(l => !/^\s*[-*]\s+Deploy of [0-9a-f]+ \(no commits/i.test(l));
  const commits = raw.map(parseCommit).filter(c => c.subject !== '');
  const undone = new Set<number>([
    ...commits.filter(c => c.kind === 'revert').flatMap(revertedBy),
    ...(Array.isArray(meta.revertedPrUrls) ? meta.revertedPrUrls.map(u => prNumberOf(String(u))).filter((n): n is number => n !== null) : []),
  ]);
  return commits.map(c => (c.kind !== 'revert' && c.pr !== null && undone.has(c.pr) ? { ...c, kind: 'reverted' as const } : c));
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function verdictOf(task: LinkedRecord | undefined, fallback: unknown): FeatureVerdict | null {
  const v = obj(task?.meta.verdict);
  if (str(v.value)) {
    return { value: str(v.value), proven: typeof v.proven === 'number' ? v.proven : null, total: typeof v.total === 'number' ? v.total : null, risksHandled: null, risksTotal: null, at: str(v.at), by: str(v.by) };
  }
  // The pack's own line: "approve, 6 of 6 proven · 2 plan risks handled",
  // "approve, 8 of 8 proven" (before the risk lines were their own group) or
  // "merged without a QA verdict".
  const line = str(fallback);
  const m = line ? /^(\w+),\s*(\d+) of (\d+) proven/.exec(line) : null;
  const r = line ? /(?:(\d+) of )?(\d+) plan risks? handled/.exec(line) : null;
  return m ? { value: m[1]!, proven: Number(m[2]), total: Number(m[3]), risksHandled: r ? Number(r[1] ?? r[2]) : null, risksTotal: r ? Number(r[2]) : null, at: null, by: null } : null;
}

/**
 * The verdict counted the one way every surface counts it (`featureProof`):
 * the work's own acceptance lines, and the plan-risk lines as their own group,
 * judged on the attempt this release shipped.
 * @param feature - The feature, with its verdict as the records hold it.
 * @param linked - The records the release names.
 */
function countedVerdict(feature: ReleaseFeature, linked: ReleaseLinked): FeatureVerdict | null {
  const tasks = feature.taskIds.map(id => linked.records.get(id)).filter((t): t is LinkedRecord => t !== undefined);
  if (feature.verdict === null || tasks.length === 0) {
    return feature.verdict;
  }
  const request = feature.requestId !== null ? linked.records.get(feature.requestId) ?? null : null;
  const proof = featureProof({ request, tasks, shippedTaskIds: feature.taskIds });
  if (proof.attempt === null || proof.total === 0) {
    return feature.verdict;
  }
  return { ...feature.verdict, proven: proof.proven, total: proof.total, risksHandled: proof.risksHandled, risksTotal: proof.risksTotal };
}

/**
 * The count a release says for one feature: "6 of 6 criteria proven, 2 plan risks handled".
 * @param v - The verdict.
 * @param noun - What the acceptance lines are called.
 */
export function verdictCount(v: FeatureVerdict, noun = 'criteria'): string | null {
  if (v.total === null) {
    return null;
  }
  const risks = v.risksTotal !== null && v.risksHandled !== null ? risksLine({ risksHandled: v.risksHandled, risksTotal: v.risksTotal }) : null;
  return `${v.proven ?? 0} of ${v.total} ${noun} proven${risks ? `, ${risks}` : ''}`;
}

/**
 * The features a release shipped — from the release pack's evidence when it
 * has one (`services/factory/releasePack.ts`), from its `taskIds` otherwise.
 * One feature per request: a request built by three tasks shipped once.
 * @param meta - The release's metadata.
 * @param linked - The records it names.
 * @param commits - Its commits, to tell a fix from an improvement.
 */
export function releaseFeatures(meta: Record<string, unknown>, linked: ReleaseLinked, commits: ReleaseCommit[] = []): ReleaseFeature[] {
  const evidence = Array.isArray(meta.evidence) ? meta.evidence.map(obj) : [];
  const entries = evidence.length > 0
    ? evidence.map(e => ({ taskId: num(e.taskId), requestId: num(e.requestId), prUrl: str(e.prUrl), verdict: e.verdict, title: str(e.title) }))
    : (Array.isArray(meta.taskIds) ? meta.taskIds : []).map(id => ({ taskId: num(id), requestId: null as number | null, prUrl: null as string | null, verdict: undefined as unknown, title: null as string | null }));
  const byKey = new Map<string, ReleaseFeature>();
  for (const e of entries) {
    if (e.taskId === null) {
      continue;
    }
    const task = linked.records.get(e.taskId);
    const requestId = e.requestId ?? num(task?.meta.requestId);
    const request = requestId !== null ? linked.records.get(requestId) : undefined;
    const prUrl = e.prUrl ?? str(task?.meta.prUrl);
    const pr = prUrl ? prNumberOf(prUrl) : null;
    const key = requestId !== null ? `r${requestId}` : `t${e.taskId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.taskIds.push(e.taskId);
      if (pr !== null && !existing.prNumbers.includes(pr)) {
        existing.prNumbers.push(pr);
      }
      existing.verdict ??= verdictOf(task, e.verdict);
      continue;
    }
    const commitKind = commits.find(c => c.pr !== null && c.pr === pr)?.kind;
    const requestKind = str(request?.meta.kind);
    byKey.set(key, {
      requestId,
      taskIds: [e.taskId],
      title: request?.title ?? task?.title ?? e.title ?? `Task ${e.taskId}`,
      outcome: firstSentence(str(request?.meta.outcome) ?? str(request?.meta.expectedResult) ?? str(task?.meta.objective)),
      kind: requestKind === 'bug' || requestKind === 'incident' || commitKind === 'fix' ? 'fix' : 'improvement',
      verdict: verdictOf(task, e.verdict),
      prNumbers: pr !== null ? [pr] : [],
      href: (linked.link ?? genericRecordLinker)(requestId !== null ? { objectType: 'request', id: requestId } : { objectType: 'engineering_task', id: e.taskId }),
    });
  }
  return [...byKey.values()].map(f => ({ ...f, verdict: countedVerdict(f, linked) }));
}

// ---------------------------------------------------------------------------
// Verification, announcement, attention
// ---------------------------------------------------------------------------

function acceptanceOf(features: ReleaseFeature[]): ReleaseVerification['acceptance'] {
  if (features.length === 0) {
    return null;
  }
  const passed = features.filter(f => f.verdict?.value === 'approve');
  const failed = features.filter(f => f.verdict !== null && f.verdict.value !== 'approve');
  const missing = features.filter(f => f.verdict === null);
  if (failed.length > 0) {
    return { state: 'failed', line: `QA did not approve ${failed.length === 1 ? failed[0]!.title : plural(failed.length, 'feature')}` };
  }
  if (missing.length > 0) {
    return { state: 'missing', line: `${plural(missing.length, 'feature')} shipped without a QA verdict` };
  }
  if (passed.length === 1) {
    const v = passed[0]!.verdict!;
    const count = verdictCount(v);
    return { state: 'passed', line: count ? `QA approved, ${count}` : 'QA approved' };
  }
  return { state: 'passed', line: `QA approved all ${passed.length} features` };
}

function healthOf(meta: Record<string, unknown>, now: Date): ReleaseVerification['health'] {
  const raw = str(meta.healthAfter);
  const value = raw === 'ok' || raw === 'degraded' || raw === 'down' || raw === 'unknown' ? raw : null;
  const checkedAt = date(meta.healthCheckedAt);
  const freshness = checkedAt && value !== null && value !== 'unknown' ? `checked ${relativeLabel(checkedAt, now.getTime())}` : null;
  switch (value) {
    case 'ok':
      return { value, line: 'Health check passed', tone: 'ok', checkedAt, freshness };
    case 'degraded':
      return { value, line: 'Health check found the service degraded', tone: 'bad', checkedAt, freshness };
    case 'down':
      return { value, line: 'Health check found the service down', tone: 'bad', checkedAt, freshness };
    default:
      return { value, line: 'No post-deploy health check recorded', tone: 'warn', checkedAt, freshness: null };
  }
}

function impactOf(row: PageRow, features: ReleaseFeature[], linked: ReleaseLinked, userFacing: boolean, now: Date, tz: string): ReleaseVerification['impact'] {
  const outcome = obj(row.meta.outcome);
  const verdict = str(outcome.verdict);
  const checked = date(outcome.checkedAt);
  const on = checked ? ` (read ${formatDate(checked, tz)})` : '';
  if (verdict === 'validated') {
    return { state: 'helped', line: `Production outcome: it did what it was for${on}`, tone: 'ok' };
  }
  if (verdict === 'regressed') {
    return { state: 'regressed', line: `Production outcome: something got worse${on}${str(outcome.note) ? ` — ${str(outcome.note)}` : ''}`, tone: 'bad' };
  }
  if (verdict === 'inconclusive') {
    return { state: 'inconclusive', line: `Production outcome: nothing moved enough to say${on}`, tone: 'muted' };
  }
  // No release-level reading: the requests it shipped carry their own.
  const requests = features.map(f => (f.requestId !== null ? linked.records.get(f.requestId) : undefined)).filter((r): r is LinkedRecord => r !== undefined);
  const results = requests.map(r => str(r.meta.result));
  if (results.includes('did_not_help')) {
    return { state: 'regressed', line: 'The result check says it did not help', tone: 'bad' };
  }
  if (requests.length > 0 && results.every(r => r === 'helped')) {
    return { state: 'helped', line: 'The result check says it helped', tone: 'ok' };
  }
  if (!userFacing) {
    return { state: 'none', line: 'No product impact to check: nothing people use changed', tone: 'muted' };
  }
  const due = requests.map(r => date(r.meta.checkAfter)).filter((d): d is Date => d !== null && d.getTime() > now.getTime()).sort((a, b) => a.getTime() - b.getTime())[0];
  if (results.includes('not_enough_evidence')) {
    return { state: 'inconclusive', line: `Not enough evidence yet to say whether it helped${due ? `; the next check is due ${formatDate(due, tz)}` : ''}`, tone: 'muted' };
  }
  if (due) {
    return { state: 'pending', line: `Result check due ${formatDate(due, tz)}`, tone: 'muted' };
  }
  const live = hoursLive(row, now);
  if (live === null) {
    return { state: 'unchecked', line: 'Outcome not checked, and the release carries no date to measure from', tone: 'muted' };
  }
  if (live < SOAK_HOURS) {
    return { state: 'pending', line: `Too early to judge: live for ${plural(Math.max(1, Math.round(live)), 'hour')}; an outcome is read after ${SOAK_HOURS} hours`, tone: 'muted' };
  }
  return { state: 'unchecked', line: `Outcome not checked: live for ${plural(Math.round(live / 24) || 1, 'day')} and no production measure has been read for it`, tone: 'warn' };
}

/**
 * Where the announcement stands, and never the placeholder as its words.
 * @param meta - The release's metadata.
 * @param userFacing - Whether anything people use changed.
 * @param notNeededReason - Why nothing needs announcing, when nothing does.
 */
export function announcementOf(meta: Record<string, unknown>, userFacing: boolean, notNeededReason = 'Only internal changes: nothing people use changed'): ReleaseAnnouncement {
  const text = announcementText(meta.announcement);
  const publishedAt = date(meta.announcedAt);
  const to = obj(meta.announcedTo);
  const channels = Array.isArray(to.channels) ? to.channels.map(String).filter(Boolean) : [];
  const base = { text, publishedAt, channels, reason: null };
  if (publishedAt) {
    return { ...base, state: 'published', label: 'Published' };
  }
  if (text !== null && meta.notesSource === 'human') {
    return { ...base, state: 'approved', label: 'Approved' };
  }
  if (text !== null) {
    return { ...base, state: 'draft', label: 'Draft ready' };
  }
  if (!userFacing) {
    return { ...base, state: 'not-needed', label: 'Not needed', reason: notNeededReason };
  }
  return { ...base, state: 'not-prepared', label: 'Not prepared' };
}

// ---------------------------------------------------------------------------
// Release notes
// ---------------------------------------------------------------------------

/**
 * The release's written notes as lines, or null when there are none a person
 * would read as notes: empty, or the deploy's own commit log. The deploy
 * writes its commit subjects into `notes` ("- schema: Download CSV… (#114)"),
 * and a later draft of the announcement set `notesSource: agent` beside them
 * without touching them — so who last wrote the field is not evidence that
 * notes were written. The words are.
 * @param meta - The release's metadata.
 */
export function writtenNotes(meta: Record<string, unknown>): string[] | null {
  const raw = str(meta.notes);
  if (raw === null) {
    return null;
  }
  const lines = raw.split('\n').map(l => l.trim().replace(/^[-*]\s+/, '').trim()).filter(Boolean);
  const subjects = new Set((Array.isArray(meta.commits) ? meta.commits.map(String) : []).map(c => parseCommit(c).subject));
  const isLog = (line: string) => {
    const c = parseCommit(line);
    return subjects.has(c.subject) || c.sha !== null || (c.type !== null && c.type !== 'internal') || c.pr !== null || /^Deploy of [0-9a-f]+/i.test(line);
  };
  return lines.length === 0 || lines.every(isLog) ? null : lines;
}

export type ReleaseNotes = {
  /** `agent` or `human` when the notes were written; `features` when they are read from what shipped. */
  source: 'agent' | 'human' | 'features';
  lines: string[];
};

/**
 * THE NOTES A PERSON READS: the written ones when someone wrote them, and
 * until then one line per change from what shipped — each feature by its own
 * title, each product change with no feature by its plain subject, each
 * internal change as "Internal: …". Never a commit subject.
 * @param meta - The release's metadata.
 * @param reading - The release, read.
 */
export function releaseNotes(meta: Record<string, unknown>, reading: Pick<ReleaseReading, 'features' | 'otherChanges' | 'internal'>): ReleaseNotes {
  const written = writtenNotes(meta);
  if (written) {
    return { source: meta.notesSource === 'human' ? 'human' : 'agent', lines: written };
  }
  return {
    source: 'features',
    lines: [
      ...reading.features.map(f => f.title),
      ...reading.otherChanges.map(c => c.plain),
      ...reading.internal.map(c => `Internal: ${c.plain}`),
    ],
  };
}

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/**
 * Whether a row is a product release or a deployment of one surface.
 * @param meta - The release's metadata.
 */
export function releaseKindOf(meta: Record<string, unknown>): ReleaseKind {
  return !Array.isArray(meta.surfaces) && str(meta.surface) !== null ? 'deployment' : 'release';
}

function productNameOf(slug: string | null, linked: ReleaseLinked): string {
  if (slug === null) {
    return 'Unnamed product';
  }
  return linked.products.get(slug) ?? sentenceCase(slug.replace(/[-_]+/g, ' '));
}

function areasOf(commits: ReleaseCommit[]): string[] {
  return [...new Set(commits.map(c => c.area).filter((a): a is string => a !== null))];
}

function countsLine(improvements: number, fixes: number): string {
  const parts = [improvements > 0 ? plural(improvements, 'improvement') : null, fixes > 0 ? plural(fixes, 'fix', 'fixes') : null].filter(Boolean) as string[];
  return listOf(parts);
}

/**
 * Read one release row.
 * @param row - The release row.
 * @param options - What else the reading needs.
 * @param options.linked - The tasks, requests and products it names.
 * @param options.now - The clock.
 * @param options.timeZone - The workspace's zone, for the dates a line quotes.
 */
export function readRelease(row: PageRow, options: { linked?: ReleaseLinked; now?: Date; timeZone?: string } = {}): ReleaseReading {
  const linked = options.linked ?? NO_LINKS;
  const now = options.now ?? new Date();
  const tz = options.timeZone ?? 'UTC';
  const meta = row.meta ?? {};
  const kind = releaseKindOf(meta);
  const productSlug = str(meta.product);
  const productName = productNameOf(productSlug, linked);
  const surfaces = Array.isArray(meta.surfaces) ? meta.surfaces.map(String).filter(Boolean) : str(meta.surface) ? [str(meta.surface)!] : [];
  const version = str(meta.version);
  const versionShort = version && /^[0-9a-f]{8,40}$/i.test(version) ? version.slice(0, 7) : version;
  const releasedAt = date(meta.releasedAt);

  const commits = releaseCommits(meta);
  const features = releaseFeatures(meta, linked, commits);
  const featurePrs = new Set(features.flatMap(f => f.prNumbers));
  const otherChanges = commits.filter(c => (c.kind === 'improvement' || c.kind === 'fix') && !(c.pr !== null && featurePrs.has(c.pr)));
  const internal = commits.filter(c => c.kind === 'internal');
  const reverted = commits.filter(c => c.kind === 'reverted');
  const userFacing = features.length > 0 || otherChanges.length > 0;
  const counts = {
    improvements: features.filter(f => f.kind === 'improvement').length + otherChanges.filter(c => c.kind === 'improvement').length,
    fixes: features.filter(f => f.kind === 'fix').length + otherChanges.filter(c => c.kind === 'fix').length,
    internal: internal.length,
    reverted: reverted.length,
  };

  // THE HEADLINE: what changed, in the product's words.
  const changeTitles = [...features.map(f => f.title), ...otherChanges.map(c => c.plain)];
  let headline: string;
  if (kind === 'deployment') {
    headline = `${productName} ${surfaces[0]} deployment`;
  } else if (changeTitles.length === 1) {
    headline = changeTitles[0]!;
  } else if (changeTitles.length > 1) {
    headline = `${changeTitles[0]}, and ${plural(changeTitles.length - 1, 'more change')}`;
  } else if (reverted.length > 0) {
    headline = 'No user-facing change';
  } else if (internal.length > 0) {
    headline = 'Internal changes only';
  } else {
    headline = `${productName} deploy`;
  }

  // THE SUMMARY: one sentence, what it means for a person.
  const sentences: string[] = [];
  if (kind === 'deployment' && changeTitles.length > 0) {
    sentences.push(changeTitles.length === 1 ? `${changeTitles[0]}.` : `${countsLine(counts.improvements, counts.fixes)}: ${listOf(changeTitles.slice(0, 3))}${changeTitles.length > 3 ? ' and more' : ''}.`);
  } else if (features.length === 1 && otherChanges.length === 0) {
    sentences.push(features[0]!.outcome ?? `${features[0]!.title}.`);
  } else if (changeTitles.length > 1) {
    sentences.push(`${sentenceCase(countsLine(counts.improvements, counts.fixes))}.`);
  }
  if (features.length === 0 && otherChanges.length > 0 && kind === 'release') {
    sentences.push(otherChanges.length === 1 ? 'No linked feature.' : `No linked feature: ${listOf(otherChanges.slice(0, 3).map((c, i) => (i === 0 ? c.plain : midSentence(c.plain))))}${otherChanges.length > 3 ? ' and more' : ''}.`);
  }
  if (reverted.length > 0) {
    sentences.push(`${listOf(reverted.map(c => c.plain))} went out and was reverted in the same deploy.`);
  }
  if (internal.length > 0) {
    const where = areasOf(internal);
    sentences.push(userFacing || reverted.length > 0
      ? `Also ${plural(internal.length, 'internal change')}${where.length > 0 ? ` (${listOf(where)})` : ''}.`
      : `${sentenceCase(plural(internal.length, 'internal change'))}${where.length > 0 ? ` to the ${listOf(where)}` : ''}; nothing people use changed.`);
  }
  if (commits.length === 0 && features.length === 0) {
    sentences.push('The deploy recorded no changes.');
  }
  const summary = sentences.join(' ');

  const acceptance = acceptanceOf(features);
  const health = healthOf(meta, now);
  const impact = impactOf(row, features, linked, userFacing, now, tz);
  const issue = health.tone === 'bad' || acceptance?.state === 'failed' || impact.state === 'regressed';
  const missing = !issue && (health.value !== 'ok' || acceptance?.state === 'missing');
  const verification: ReleaseVerification = {
    state: issue ? 'issue' : missing ? 'missing' : 'verified',
    label: issue ? 'Issue detected' : missing ? 'Verification missing' : 'Verified',
    acceptance,
    health,
    impact,
    // A health check that did not pass is said once, as what needs a person
    // (the attention line), not a second time as evidence beside it.
    line: [acceptance?.line, health.value === 'ok' ? health.line : null, health.value === 'ok' ? health.freshness : null].filter((s): s is string => Boolean(s)).join(' · '),
  };

  const notNeeded = reverted.length > 0 && internal.length === 0
    ? 'No user-facing change: what went out was reverted in the same deploy'
    : 'Only internal changes: nothing people use changed';
  const announcement = announcementOf(meta, userFacing, notNeeded);

  // Who asked for something this shipped and has not heard. A request filed
  // by an agent names no asker, and there is nobody to tell.
  const waitingRequesters = features
    .map(f => (f.requestId !== null ? linked.records.get(f.requestId) : undefined))
    .filter((r): r is LinkedRecord => r !== undefined && Object.keys(obj(r.meta.askedBy)).length > 0)
    .filter((r) => {
      const status = str(obj(r.meta.told).status);
      return status !== 'sent' && status !== 'not_needed';
    });

  const attention: string[] = [];
  if (health.tone === 'bad') {
    attention.push(`${health.line} after this deploy`);
  } else if (health.value !== 'ok') {
    attention.push('No post-deploy health check was recorded');
  }
  if (acceptance?.state === 'failed' || acceptance?.state === 'missing') {
    attention.push(acceptance.line);
  }
  if (impact.state === 'regressed') {
    attention.push(impact.line);
  }
  if (waitingRequesters.length > 0) {
    attention.push(`${plural(waitingRequesters.length, 'person', 'people')} who asked ${waitingRequesters.length === 1 ? 'has' : 'have'} not been told it shipped`);
  }

  return {
    kind,
    productSlug,
    productName,
    surfaces,
    version,
    versionShort,
    releasedAt,
    headline,
    summary,
    commits,
    features,
    otherChanges,
    internal,
    reverted,
    userFacing,
    counts,
    verification,
    announcement,
    waitingRequesters,
    attention,
  };
}

/**
 * The day heading a release sits under, in the workspace's zone.
 * @param at - When it was released.
 * @param now - The clock.
 * @param timeZone - The workspace's zone.
 */
export function releaseDayLabel(at: Date | null, now: Date, timeZone: string): string {
  if (at === null) {
    return 'No release date';
  }
  const ago = dayDistance(at, now, timeZone);
  if (ago === 0) {
    return `Today · ${formatDate(at, timeZone)}`;
  }
  if (ago === 1) {
    return `Yesterday · ${formatDate(at, timeZone)}`;
  }
  return formatDate(at, timeZone);
}

/**
 * Every release row, carrying the words the Releases feed is declared in.
 *
 * Runs the outcome derivation's fields too, so nothing that read
 * `outcomeLine` loses it. Pure, like `deriveWorkQueue`.
 * @param rows - The release rows.
 * @param options - The linked records, the clock and the zone.
 * @param options.linked - Tasks, requests and product names the rows name.
 * @param options.now - The clock.
 * @param options.timeZone - The workspace's zone, for day headings and times.
 */
export function deriveReleaseFeed(rows: PageRow[], options: { linked?: ReleaseLinked; now?: Date; timeZone?: string } = {}): PageRow[] {
  const now = options.now ?? new Date();
  const tz = options.timeZone ?? 'UTC';
  return rows.map((row) => {
    const r = readRelease(row, { linked: options.linked, now, timeZone: tz });
    const when = r.releasedAt ? formatTime(r.releasedAt, tz) : null;
    const where = r.surfaces.length === 0 ? null : r.kind === 'deployment' ? `${r.surfaces[0]} only` : r.surfaces.join(' + ');
    return {
      ...row,
      meta: {
        ...row.meta,
        headline: r.headline,
        versionShort: r.versionShort ?? undefined,
        productName: r.productName,
        context: [r.productName, where, when].filter(Boolean).join(' · '),
        summary: r.summary,
        verification: r.verification.label,
        verificationLine: r.verification.line,
        communication: r.announcement.label,
        attention: r.attention.length > 0 ? r.attention.join(' · ') : undefined,
        needsAttention: r.attention.length > 0,
        issueDetected: r.verification.state === 'issue',
        verificationMissing: r.verification.state === 'missing',
        releaseKind: r.kind,
        releaseDay: r.releasedAt ? dayKey(r.releasedAt, tz) : undefined,
        releaseDayLabel: releaseDayLabel(r.releasedAt, now, tz),
      },
    };
  });
}
