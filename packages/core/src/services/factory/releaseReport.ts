import type { ReleaseArtifact } from './releaseData';
import type { CriterionEvidence } from '@/libs/workspace/criterionEvidence';
import type { ProofState } from '@/libs/workspace/featureProof';
import type { PageRow } from '@/libs/workspace/pageFields';
import type { FeatureVerdict, LinkedRecord, ReleaseCommit, ReleaseFeature, ReleaseLinked, ReleaseNotes, ReleaseReading, Tone } from '@/libs/workspace/releaseFeed';
import { liveReasonSentence, readLiveReason } from '@/libs/factory/liveCheck';
import { formatDateTime } from '@/libs/time/zone';
import { criterionEvidence, shotParts } from '@/libs/workspace/criterionEvidence';
import { featureProof, isPlanRiskLine, PLAN_RISK_PREFIX } from '@/libs/workspace/featureProof';
import { formatMoney } from '@/libs/workspace/pageFields';
import { genericRecordLinker, rawRecordPath } from '@/libs/workspace/recordHref';
import { firstSentence, NO_LINKS, prNumberOf, readRelease, releaseNotes, verdictCount } from '@/libs/workspace/releaseFeed';

/**
 * THE RELEASE PAGE — one release, read the way the person who owns the
 * product reads it: what changed for users, whether it is live and verified,
 * whether anything needs them, and who should hear about it. The technical
 * record is the last section, one click from every claim above it.
 *
 * Pure: the rows come in, the sections go out, and the drawing
 * (`features/dashboard/factory/ReleaseDetailView.tsx`) decides nothing. The
 * reading itself is `libs/workspace/releaseFeed.ts`, shared with the list, so
 * the page and its row cannot disagree.
 *
 * Sections, in order: summary, what changed, verification, announcement,
 * included work, activity, technical details. A section with nothing to say
 * says so in one line, never as a heading over an empty box.
 */

export type ReleaseChange = {
  key: string;
  label: 'Improvement' | 'Fix' | 'Reverted' | 'Internal';
  title: string;
  /** One plain sentence under the title, when there is one. */
  detail: string | null;
  href: string | null;
};

export type ReleaseCheck = {
  key: string;
  title: string;
  line: string;
  tone: Tone;
  at: string | null;
  href: string | null;
  /** What the check itself reported, for whoever fixes it: one click away, under the line. */
  detail?: string | null;
};

/** One state captured on the live product after the deploy. */
export type ReleaseLiveShot = { key: string; criterion: string; reached: boolean; reason: string | null; detail?: string | null; imageUrl: string | null; href: string | null };

/**
 * The live shot the announcement leads with (`announcementImageArtifactId`,
 * set by the post-deploy check), when it is a picture in this workspace.
 * @param meta - The release's metadata.
 * @param artifacts - The artifacts the page loaded.
 */
function announcementImage(meta: Record<string, unknown>, artifacts: ReleaseArtifact[]): { url: string; href: string } | null {
  const art = artifacts.find(a => a.id === Number(meta.announcementImageArtifactId));
  return art?.url && art.kind !== 'markdown' ? { url: art.url, href: artifactHref(art.id) } : null;
}

/**
 * The post a press published, as the release recorded it (`announcedTo.post`).
 * @param meta - The release's metadata.
 */
function announcedPost(meta: Record<string, unknown>): { surface: 'slack'; runId: number | null } | null {
  const to = meta.announcedTo && typeof meta.announcedTo === 'object' ? meta.announcedTo as Record<string, unknown> : {};
  const post = to.post && typeof to.post === 'object' ? to.post as Record<string, unknown> : null;
  if (!post || post.surface !== 'slack') {
    return null;
  }
  const runId = Number(post.runId);
  return { surface: 'slack', runId: Number.isSafeInteger(runId) && runId > 0 ? runId : null };
}

/**
 * Why the last press did not publish, with when (`announceFailure`).
 * @param meta - The release's metadata.
 * @param tz - The workspace's zone.
 */
function announceFailure(meta: Record<string, unknown>, tz: string): string | null {
  const f = meta.announceFailure && typeof meta.announceFailure === 'object' ? meta.announceFailure as Record<string, unknown> : null;
  const error = f ? str(f.error) : null;
  if (!error) {
    return null;
  }
  const at = when(f!.at, tz);
  return `Not published${at ? ` (${at})` : ''}: ${error}`;
}

/**
 * The post-deploy live check, from what the check wrote on the release
 * (`liveEvidence`, `liveSummary`, `liveState`, `liveCheckedAt`); before one
 * ran, "Not yet seen live" for a release people use, else null.
 * @param meta - The release's metadata.
 * @param artifacts - The artifacts the page loaded.
 * @param tz - The workspace's zone.
 * @param live - The release reading's live check (`releaseFeed.ts`).
 */
function liveCheck(meta: Record<string, unknown>, artifacts: ReleaseArtifact[], tz: string, live: ReleaseReading['verification']['live']): (ReleaseCheck & { shots: ReleaseLiveShot[] }) | null {
  const rows = Array.isArray(meta.liveEvidence) ? meta.liveEvidence as Array<Record<string, unknown>> : [];
  if (live.state === 'none') {
    return null;
  }
  if (live.state === 'pending') {
    return { key: 'live', title: 'Live check', line: `${live.line}: QA checks it on the live product, signed in as the product's QA account`, tone: 'warn', at: null, href: str(meta.url), shots: [] };
  }
  const byId = new Map(artifacts.map(a => [a.id, a]));
  const shots = rows.map((e, i): ReleaseLiveShot => {
    const art = byId.get(Number(e.artifactId));
    // Why, in a sentence, from the reason typed where it happened; the check's words beneath.
    const why = readLiveReason(e.why);
    return {
      key: `live-${i}`,
      criterion: str(e.criterion) ?? str(e.flow) ?? 'A live state',
      reached: e.status === 'reached',
      reason: why ? liveReasonSentence(why) : str(e.reason),
      ...(why ? { detail: why.detail } : {}),
      imageUrl: art?.url && art.kind !== 'markdown' ? art.url : null,
      href: art ? artifactHref(art.id) : str(e.url),
    };
  });
  return {
    key: 'live',
    title: 'Live check',
    line: live.line,
    tone: live.tone,
    at: when(meta.liveCheckedAt, tz),
    href: str(meta.url),
    detail: live.state === 'seen' ? null : live.detail ?? null,
    shots,
  };
}

/**
 * One criterion on the release page: its words, whether it passed, and the
 * proof one click away — the after shot as a thumbnail (the before shot
 * beside it), or the named test and the stored run that holds its output.
 */
export type ReleaseProofRow = {
  key: string;
  statement: string;
  state: ProofState;
  tone: Tone;
  kind: CriterionEvidence['kind'];
  /** "Screenshot", "Named test “…” passed", or why there is nothing to open. */
  line: string;
  /** The proof: the artifact's page (at the test's section when it has one), else the link QA named. */
  href: string | null;
  /** The after shot, drawn small. */
  imageUrl: string | null;
  before: { href: string; label: string } | null;
};

/** One shipped feature's criteria, the plan's risks as their own group. */
export type ReleaseProofGroup = { key: string; title: string; href: string; acceptance: ReleaseProofRow[]; risks: ReleaseProofRow[] };

export type ReleaseAction = 'draft' | 'review' | 'publish';

export type ReleaseActivity = { key: string; at: Date; line: string; href: string | null; when?: string };

export type ReleaseLink = { key: string; label: string; href: string | null };

export type ReleaseReport = {
  id: number;
  title: string;
  kind: ReleaseReading['kind'];
  /** "Send · 930a23f" — product and short version, under the title. */
  subtitle: string;
  product: { name: string; slug: string | null };
  surfaces: string[];
  releasedAt: string | null;
  liveUrl: string | null;
  /** The deploy's state and the verification's, as the header's two dots. */
  status: { deploy: { line: string; tone: Tone }; verification: { line: string; tone: Tone } };
  summary: string;
  attention: string[];
  changes: ReleaseChange[];
  /** The notes a person reads: written ones, or the features' own titles until someone writes them. */
  notes: ReleaseNotes;
  verification: {
    /** Per feature: the summary line, and under it each criterion with its proof. */
    acceptance: Array<ReleaseCheck & { proof: ReleaseProofGroup | null }>;
    deployCheck: ReleaseCheck;
    /**
     * The live product after the deploy (post-deploy QA): each feature's
     * states replayed on production, signed in with the product's QA sign-in,
     * and the picture of each. Null until a live check has run.
     */
    live: (ReleaseCheck & { shots: ReleaseLiveShot[] }) | null;
    impact: ReleaseCheck[];
  };
  announcement: ReleaseReading['announcement'] & {
    /** The live screenshot the announcement leads with, when the live check found one. */
    image: { url: string; href: string } | null;
    /** The one move the state offers, or null. */
    action: ReleaseAction | null;
    /**
     * Advice beside the move, when the release's own checks say something a
     * person should weigh before announcing — a release that is down. It
     * informs; it never takes the move away.
     */
    blocked: string | null;
    publishedLine: string | null;
    requesters: string | null;
    /**
     * One press that publishes the words with the picture: to Slack when the
     * workspace has a connection, else a copy as rich text (and the picture
     * as a download). Null when there is nothing to publish, or it is out.
     */
    publish: { mode: 'slack' | 'copy' } | null;
    /** The post a press published, so the page can offer Undo on its run. */
    post: { surface: 'slack'; runId: number | null } | null;
    /** Why the last press did not publish, written on the release by the post that failed. */
    failure: string | null;
  };
  included: Array<{ key: string; title: string; href: string; detail: string }>;
  activity: ReleaseActivity[];
  technical: {
    facts: Array<{ label: string; value: string; href?: string; mono?: boolean }>;
    pullRequests: ReleaseLink[];
    commits: Array<{ key: string; sha: string | null; subject: string; label: string }>;
    evidence: ReleaseLink[];
    records: ReleaseLink[];
  };
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function when(v: unknown, tz: string): string | null {
  const d = typeof v === 'string' || v instanceof Date ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? formatDateTime(d, tz) : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const COMMIT_LABEL: Record<ReleaseCommit['kind'], string> = {
  improvement: 'Product change',
  fix: 'Product fix',
  internal: 'Internal',
  revert: 'Revert',
  reverted: 'Reverted',
};

function verdictLine(v: FeatureVerdict | null): { line: string; tone: Tone } {
  if (v === null) {
    return { line: 'Shipped without a QA verdict', tone: 'warn' };
  }
  // The count the feature's own page shows (`libs/workspace/featureProof.ts`).
  const count = verdictCount(v);
  const counted = count ? `, ${count}` : '';
  const who = v.by ? ` (${v.by})` : '';
  if (v.value === 'approve') {
    return { line: `QA approved${counted}${who}`, tone: 'ok' };
  }
  return { line: `QA said ${v.value}${counted}${who}`, tone: 'bad' };
}

const STATE_TONE: Record<ProofState, Tone> = { passed: 'ok', failed: 'bad', unverified: 'warn' };

function artifactHref(id: number, anchor?: string): string {
  return `/dashboard/artifacts/${id}${anchor ? `#${anchor}` : ''}`;
}

/**
 * A plan-risk line as a person reads it: the risk, without the contract's
 * prefix or the mitigation paragraph after it.
 * @param statement - The contract line.
 */
function riskWords(statement: string): string {
  return isPlanRiskLine(statement) ? firstSentence(statement.trim().slice(PLAN_RISK_PREFIX.trim().length).trim()) ?? statement : statement;
}

/**
 * One shipped feature's criteria with their proof, from the one count
 * (`featureProof`) and the artifacts the attempt that counts stored.
 * @param f - The feature.
 * @param linked - The records the release names.
 * @param artifacts - The artifacts the release cites.
 */
function proofGroup(f: ReleaseFeature, linked: ReleaseLinked, artifacts: ReleaseArtifact[]): ReleaseProofGroup | null {
  const tasks = f.taskIds.map(id => linked.records.get(id)).filter((t): t is LinkedRecord => t !== undefined);
  if (tasks.length === 0) {
    return null;
  }
  const request = f.requestId !== null ? linked.records.get(f.requestId) ?? null : null;
  const proof = featureProof({ request, tasks, shippedTaskIds: f.taskIds });
  if (proof.attempt === null || proof.acceptance.length + proof.risks.length === 0) {
    return null;
  }
  const byId = new Map(artifacts.map(a => [a.id, a]));
  const paired = criterionEvidence(proof, artifacts);
  const row = (c: typeof proof.acceptance[number], i: number): ReleaseProofRow => {
    const e = paired[i]!;
    const art = e.artifactId !== null ? byId.get(e.artifactId) : undefined;
    const before = e.beforeArtifactId !== undefined ? byId.get(e.beforeArtifactId) : undefined;
    const word = c.state === 'passed' ? 'passed' : c.state === 'failed' ? 'failed' : 'not proven';
    const line = e.kind === 'test'
      ? `Named test${e.testName ? ` “${e.testName}”` : ''} ${word}`
      : e.kind === 'screenshot'
        ? (c.state === 'failed' ? 'Screenshot shows it failing' : c.state === 'passed' ? 'Screenshot' : 'Screenshot, not accepted as proof')
        : c.note ?? (c.evidence ? firstSentence(c.evidence) ?? c.evidence : 'No evidence attached');
    const beforeUnseen = before && before.kind === 'markdown';
    return {
      key: `${f.requestId ?? f.taskIds[0]}-${c.group}-${i}`,
      statement: c.group === 'risk' ? riskWords(c.statement) : c.statement,
      state: c.state,
      tone: STATE_TONE[c.state],
      kind: e.kind,
      line: c.note && e.kind !== null ? `${line} · ${c.note}` : line,
      href: art ? artifactHref(art.id, e.anchor) : c.evidenceUrl,
      imageUrl: e.kind === 'screenshot' && art?.url && art.kind !== 'markdown' ? art.url : null,
      before: before ? { href: artifactHref(before.id), label: beforeUnseen ? 'Before: not captured' : 'Before' } : null,
    };
  };
  const all = [...proof.acceptance, ...proof.risks].map(row);
  return {
    key: `proof-${f.requestId ?? f.taskIds[0]}`,
    title: f.title,
    href: f.href,
    acceptance: all.slice(0, proof.acceptance.length),
    risks: all.slice(proof.acceptance.length),
  };
}

/**
 * The evidence list under Technical details: each artifact once — a capture
 * that stored the same picture twice is one line — labelled by what it is.
 * @param ids - `verificationArtifactIds`.
 * @param artifacts - The artifacts loaded for them.
 */
function evidenceLinks(ids: number[], artifacts: ReleaseArtifact[]): ReleaseLink[] {
  const byId = new Map(artifacts.map(x => [x.id, x]));
  const seen = new Set<string>();
  const out: ReleaseLink[] = [];
  for (const id of ids) {
    const x = byId.get(id);
    if (!x) {
      out.push({ key: `e-${id}`, label: `Evidence artifact ${id} is not in this workspace`, href: null });
      continue;
    }
    const same = x.url ? x.url.replace(/[?#].*$/, '') : `id:${id}`;
    if (seen.has(same)) {
      continue;
    }
    seen.add(same);
    const side = x.role === 'qa-screenshot' ? shotParts(x.title).side : null;
    const label = x.role === 'qa-test-run'
      ? `Named tests: ${x.title}`
      : x.role === 'qa-screenshot'
        ? side === 'before' && x.kind === 'markdown' ? `Before, not captured: ${x.title}` : `QA screenshot: ${x.title}`
        : `Evidence: ${x.title}`;
    out.push({ key: `e-${id}`, label, href: artifactHref(id) });
  }
  return out;
}

/**
 * Assemble one release's page.
 * @param row - The release record.
 * @param options - What else the page reads.
 * @param options.linked - The tasks, requests and product it names.
 * @param options.artifacts - The evidence artifacts it cites.
 * @param options.now - The clock.
 * @param options.timeZone - The workspace's zone.
 * @param options.announceMode - Where a press publishes the announcement (`services/factory/releaseAnnounce.ts`); copy when unsaid.
 */
export function assembleReleaseReport(row: PageRow, options: { linked?: ReleaseLinked; artifacts?: ReleaseArtifact[]; now?: Date; timeZone?: string; announceMode?: 'slack' | 'copy' } = {}): ReleaseReport {
  const linked = options.linked ?? NO_LINKS;
  const now = options.now ?? new Date();
  const tz = options.timeZone ?? 'UTC';
  const meta = row.meta ?? {};
  const r = readRelease(row, { linked, now, timeZone: tz });
  const liveUrl = str(meta.url);

  // WHAT CHANGED, one line per change a person would notice, then what went
  // out and came back, then the machinery — labelled as machinery.
  const changes: ReleaseChange[] = [
    ...r.features.map(f => ({ key: `f-${f.requestId ?? f.taskIds[0]}`, label: f.kind === 'fix' ? 'Fix' as const : 'Improvement' as const, title: f.title, detail: f.outcome, href: f.href })),
    ...r.otherChanges.map((c, i) => ({ key: `c-${c.sha ?? i}`, label: c.kind === 'fix' ? 'Fix' as const : 'Improvement' as const, title: c.plain, detail: 'No linked feature: this change reached the product without a factory request behind it.', href: null })),
    ...r.reverted.map((c, i) => ({ key: `r-${c.sha ?? i}`, label: 'Reverted' as const, title: c.plain, detail: 'Went out and was reverted in the same deploy, so it is not live.', href: null })),
    ...r.internal.map((c, i) => ({ key: `i-${c.sha ?? i}`, label: 'Internal' as const, title: c.plain, detail: c.area ? `Changes the ${c.area}, not the product people use.` : 'Not a change to the product people use.', href: null })),
  ];

  // VERIFICATION: three different questions, never merged into one badge.
  // Each feature's summary line stays on top; under it, every criterion
  // with the proof it rests on (principle 10: the claim and its evidence in
  // one move), not a link to the feature page that holds them.
  const acceptance = r.features.map((f) => {
    const v = verdictLine(f.verdict);
    return { key: `qa-${f.requestId ?? f.taskIds[0]}`, title: f.title, line: v.line, tone: v.tone, at: when(f.verdict?.at, tz), href: f.href, proof: proofGroup(f, linked, options.artifacts ?? []) };
  });
  const health = r.verification.health;
  const deployCheck: ReleaseCheck = {
    key: 'health',
    title: 'Post-deploy check',
    line: health.value === null || health.value === 'unknown'
      ? 'Not recorded: nothing reported on the deployed version after the deploy'
      : `${health.line}${liveUrl ? ` on ${hostOf(liveUrl)}` : ''}`,
    tone: health.tone,
    at: when(health.checkedAt, tz),
    href: liveUrl,
  };
  const impact: ReleaseCheck[] = [{ key: 'impact', title: 'Product impact', line: r.verification.impact.line, tone: r.verification.impact.tone, at: when(obj(meta.outcome).checkedAt, tz), href: str(obj(meta.outcome).evidenceUrl) }];
  for (const f of r.features) {
    const req = f.requestId !== null ? linked.records.get(f.requestId) : undefined;
    const note = str(req?.meta.resultNote);
    if (req && (note || str(req.meta.howWeCheck))) {
      impact.push({
        key: `result-${req.id}`,
        title: `Result check: ${f.title}`,
        line: note ?? `Not read yet. How it will be checked: ${str(req.meta.howWeCheck)}`,
        tone: str(req.meta.result) === 'helped' ? 'ok' : str(req.meta.result) === 'did_not_help' ? 'bad' : 'muted',
        at: when(req.meta.resultCheckedAt, tz),
        href: f.href,
      });
    }
  }

  // THE ANNOUNCEMENT as a workflow: one move per state.
  const a = r.announcement;
  const down = health.value === 'down';
  const action: ReleaseAction | null = a.state === 'not-prepared' ? 'draft' : a.state === 'draft' ? 'review' : a.state === 'approved' ? 'publish' : null;
  const requesterCount = r.waitingRequesters.length;
  const announcement = {
    ...a,
    action,
    blocked: down && a.text !== null && a.state !== 'published' ? 'The health check found the service down; announcing now points people at something that is not working.' : null,
    publishedLine: a.publishedAt ? `Published ${formatDateTime(a.publishedAt, tz)}${a.channels.length > 0 ? ` to ${a.channels.join(', ')}` : ''}` : null,
    requesters: requesterCount > 0 ? `${requesterCount === 1 ? '1 person who asked has' : `${requesterCount} people who asked have`} not been told it shipped.` : null,
    publish: a.text !== null && a.state !== 'published' ? { mode: options.announceMode ?? 'copy' } : null,
    post: announcedPost(meta),
    failure: a.state === 'published' ? null : announceFailure(meta, tz),
  };

  // INCLUDED WORK: each feature once, by its own title. Deploying code does
  // not close a request — whether it did what it was for is its result check.
  const included = r.features.map((f) => {
    const req = f.requestId !== null ? linked.records.get(f.requestId) : undefined;
    const tasks = f.taskIds.length === 1 ? 'built by 1 task' : `built by ${f.taskIds.length} tasks`;
    const result = str(req?.meta.result);
    const outcome = result === 'helped' ? 'the result check says it helped' : result === 'did_not_help' ? 'the result check says it did not help' : 'its result has not been confirmed';
    return { key: `w-${f.requestId ?? f.taskIds[0]}`, title: f.title, href: f.href, detail: `Shipped in this release, ${tasks}; ${outcome}.` };
  });

  // ACTIVITY: what happened to this release, in order, each with its time.
  const activity: ReleaseActivity[] = [];
  const at = (v: unknown) => {
    const d = typeof v === 'string' ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  for (const f of r.features) {
    const d = at(f.verdict?.at);
    if (d) {
      activity.push({ key: `a-qa-${f.requestId ?? f.taskIds[0]}`, at: d, line: `${verdictLine(f.verdict).line}: ${f.title}`, href: f.href });
    }
  }
  if (r.releasedAt) {
    activity.push({ key: 'a-released', at: r.releasedAt, line: `Deployed${r.surfaces.length > 0 ? ` ${r.surfaces.join(' + ')}` : ''}${r.versionShort ? ` at ${r.versionShort}` : ''}`, href: liveUrl });
  }
  if (health.checkedAt && health.value !== null && health.value !== 'unknown') {
    activity.push({ key: 'a-health', at: health.checkedAt, line: health.line, href: null });
  }
  if (a.publishedAt) {
    activity.push({ key: 'a-announced', at: a.publishedAt, line: `Announcement published${a.channels.length > 0 ? ` to ${a.channels.join(', ')}` : ''}`, href: null });
  }
  for (const f of r.features) {
    const req = f.requestId !== null ? linked.records.get(f.requestId) : undefined;
    const told = obj(req?.meta.told);
    const toldAt = at(told.at);
    if (toldAt) {
      activity.push({ key: `a-told-${req!.id}`, at: toldAt, line: `The person who asked for ${f.title} was ${told.status === 'failed' ? 'not reached' : 'told'}${str(told.channel) ? ` on ${str(told.channel)}` : ''}`, href: f.href });
    }
    const checked = at(req?.meta.resultCheckedAt);
    if (checked) {
      activity.push({ key: `a-result-${req!.id}`, at: checked, line: `Result checked for ${f.title}: ${(str(req!.meta.result) ?? 'no result').replace(/_/g, ' ')}`, href: f.href });
    }
  }
  const outcomeAt = at(obj(meta.outcome).checkedAt);
  if (outcomeAt) {
    activity.push({ key: 'a-outcome', at: outcomeAt, line: r.verification.impact.line, href: str(obj(meta.outcome).evidenceUrl) });
  }
  activity.sort((x, y) => x.at.getTime() - y.at.getTime());
  for (const e of activity) {
    e.when = formatDateTime(e.at, tz);
  }

  // TECHNICAL DETAILS — the record, for the person checking a claim above.
  const prUrls = (Array.isArray(meta.prUrls) ? meta.prUrls : []).map(String);
  const pullRequests: ReleaseLink[] = prUrls.map((url) => {
    const n = prNumberOf(url);
    const commit = r.commits.find(c => c.pr !== null && c.pr === n);
    return { key: url, label: `${n !== null ? `#${n}` : 'Pull request'}${commit ? ` · ${commit.plain}` : ''}${commit && (commit.kind === 'internal' || commit.kind === 'reverted') ? ` (${COMMIT_LABEL[commit.kind].toLowerCase()})` : ''}`, href: url };
  });
  const artifactIds = (Array.isArray(meta.verificationArtifactIds) ? meta.verificationArtifactIds : []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  const evidence = evidenceLinks(artifactIds, options.artifacts ?? []);
  const link = linked.link ?? genericRecordLinker;
  // ONE LINK FOR EVERY RECORD (`recordHref`): a task opens where its
  // workspace opens one, and a task no page claims opens the run that built
  // it — "Engineering task 222" led to the raw record, the page that says
  // least about what the task did.
  const taskHref = (id: number) => {
    const href = link({ objectType: linked.records.get(id)?.type, id });
    const run = Number(linked.records.get(id)?.meta.workerRunId ?? linked.records.get(id)?.meta.runId);
    return href.endsWith(rawRecordPath(id)) && Number.isSafeInteger(run) && run > 0
      ? `${href.slice(0, href.length - rawRecordPath(id).length)}/dashboard/p/runs/${run}`
      : href;
  };
  const records: ReleaseLink[] = [
    // The raw record, deliberately: this IS the release's page, and the
    // generic view is where its fields are edited and its history read.
    { key: 'release', label: `Release record ${row.id}`, href: `/dashboard/objects/${row.id}` },
    ...r.features.flatMap(f => [
      ...(f.requestId !== null ? [{ key: `req-${f.requestId}`, label: `Request ${f.requestId} · ${f.title}`, href: f.href }] : []),
      ...f.taskIds.map((t) => {
        const run = linked.records.get(t)?.meta.workerRunId ?? linked.records.get(t)?.meta.runId;
        return { key: `task-${t}`, label: `Engineering task ${t}${run ? ` · run ${String(run)}` : ''} · ${linked.records.get(t)?.title ?? f.title}`, href: taskHref(t) };
      }),
    ]),
  ];
  const facts: ReleaseReport['technical']['facts'] = [];
  if (r.surfaces.length > 0) {
    facts.push({ label: r.kind === 'deployment' ? 'Surface' : 'Surfaces deployed', value: r.kind === 'deployment' ? `${r.surfaces[0]} (recorded as its own deployment, before one release per deploy)` : r.surfaces.join(', ') });
  }
  if (liveUrl) {
    facts.push({ label: 'Deployed URL', value: hostOf(liveUrl), href: liveUrl });
  }
  if (str(meta.deployRunUrl)) {
    facts.push({ label: 'Deploy run', value: hostOf(str(meta.deployRunUrl)!), href: str(meta.deployRunUrl)! });
  }
  if (str(meta.commitSha)) {
    facts.push({ label: 'Commit', value: str(meta.commitSha)!, mono: true });
  }
  if (str(meta.previousCommitSha)) {
    facts.push({ label: 'Previous deploy', value: str(meta.previousCommitSha)!, mono: true });
  }
  if (r.version) {
    facts.push({ label: 'Version', value: r.version, mono: true });
  }
  // Cost only with a meaning, and missing cost is not zero.
  const cents = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const actual = cents(meta.actualCents);
  const estimate = cents(meta.estimateCents);
  facts.push({
    label: 'Build spend',
    value: actual === null
      ? 'Not recorded for this release'
      : `${formatMoney(actual)} model spend on the tasks it shipped${estimate !== null && estimate > 0 ? `, against ${formatMoney(estimate)} estimated` : ''}${when(meta.rollupsUpdatedAt, tz) ? ` (as of ${when(meta.rollupsUpdatedAt, tz)})` : ''}`,
  });

  const verificationTone: Tone = r.verification.state === 'issue' ? 'bad' : r.verification.state === 'missing' ? 'warn' : 'ok';
  return {
    id: Number(row.id),
    title: r.headline,
    kind: r.kind,
    subtitle: [r.productName, r.versionShort].filter(Boolean).join(' · '),
    product: { name: r.productName, slug: r.productSlug },
    surfaces: r.surfaces,
    releasedAt: r.releasedAt ? formatDateTime(r.releasedAt, tz) : null,
    liveUrl,
    status: {
      deploy: health.value === 'down'
        ? { line: 'Deployed, service down', tone: 'bad' }
        : r.releasedAt
          ? { line: liveUrl ? `Live on ${hostOf(liveUrl)}` : 'Deployed', tone: health.value === 'ok' ? 'ok' : 'warn' }
          : { line: 'No deploy time recorded', tone: 'warn' },
      verification: { line: r.verification.label, tone: verificationTone },
    },
    summary: r.summary,
    attention: r.attention,
    changes,
    notes: releaseNotes(meta, r),
    verification: { acceptance, deployCheck, live: liveCheck(meta, options.artifacts ?? [], tz, r.verification.live), impact },
    announcement: { ...announcement, image: announcementImage(meta, options.artifacts ?? []) },
    included,
    activity,
    technical: {
      facts,
      pullRequests,
      commits: r.commits.map((c, i) => ({ key: `${c.sha ?? 'n'}-${i}`, sha: c.sha, subject: c.subject, label: COMMIT_LABEL[c.kind] })),
      evidence,
      records,
    },
  };
}
