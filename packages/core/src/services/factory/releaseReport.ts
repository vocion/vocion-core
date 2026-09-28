import type { ReleaseArtifact } from './releaseData';
import type { PageRow } from '@/libs/workspace/pageFields';
import type { FeatureVerdict, ReleaseCommit, ReleaseLinked, ReleaseReading, Tone } from '@/libs/workspace/releaseFeed';
import { formatDateTime } from '@/libs/time/zone';
import { formatMoney } from '@/libs/workspace/pageFields';
import { genericRecordLinker } from '@/libs/workspace/recordHref';
import { NO_LINKS, prNumberOf, readRelease, verdictCount } from '@/libs/workspace/releaseFeed';

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

export type ReleaseCheck = { key: string; title: string; line: string; tone: Tone; at: string | null; href: string | null };

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
  verification: {
    acceptance: ReleaseCheck[];
    deployCheck: ReleaseCheck;
    impact: ReleaseCheck[];
  };
  announcement: ReleaseReading['announcement'] & {
    /** The one move the state offers, or null. */
    action: ReleaseAction | null;
    /** Why the move is held, when it is — a release that is down is not announced. */
    blocked: string | null;
    publishedLine: string | null;
    requesters: string | null;
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
  const count = verdictCount(v, 'acceptance criteria');
  const counted = count ? `, ${count}` : '';
  const who = v.by ? ` (${v.by})` : '';
  if (v.value === 'approve') {
    return { line: `QA approved${counted}${who}`, tone: 'ok' };
  }
  return { line: `QA said ${v.value}${counted}${who}`, tone: 'bad' };
}

/**
 * Assemble one release's page.
 * @param row - The release record.
 * @param options - What else the page reads.
 * @param options.linked - The tasks, requests and product it names.
 * @param options.artifacts - The evidence artifacts it cites.
 * @param options.now - The clock.
 * @param options.timeZone - The workspace's zone.
 */
export function assembleReleaseReport(row: PageRow, options: { linked?: ReleaseLinked; artifacts?: ReleaseArtifact[]; now?: Date; timeZone?: string } = {}): ReleaseReport {
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
  const acceptance: ReleaseCheck[] = r.features.map((f) => {
    const v = verdictLine(f.verdict);
    return { key: `qa-${f.requestId ?? f.taskIds[0]}`, title: f.title, line: v.line, tone: v.tone, at: when(f.verdict?.at, tz), href: f.href };
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
    blocked: down && action === 'publish' ? 'The health check found the service down; a release that is down is not announced.' : null,
    publishedLine: a.publishedAt ? `Published ${formatDateTime(a.publishedAt, tz)}${a.channels.length > 0 ? ` to ${a.channels.join(', ')}` : ''}` : null,
    requesters: requesterCount > 0 ? `${requesterCount === 1 ? '1 person who asked has' : `${requesterCount} people who asked have`} not been told it shipped.` : null,
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
  const byId = new Map((options.artifacts ?? []).map(x => [x.id, x]));
  const evidence: ReleaseLink[] = artifactIds.map((id) => {
    const x = byId.get(id);
    return x
      ? { key: `e-${id}`, label: `${x.role === 'qa-screenshot' ? 'QA screenshot' : 'Evidence'}: ${x.title}`, href: `/dashboard/artifacts/${id}` }
      : { key: `e-${id}`, label: `Evidence artifact ${id} is not in this workspace`, href: null };
  });
  const records: ReleaseLink[] = [
    // The raw record, deliberately: this IS the release's page, and the
    // generic view is where its fields are edited and its history read.
    { key: 'release', label: `Release record ${row.id}`, href: `/dashboard/objects/${row.id}` },
    ...r.features.flatMap(f => [
      ...(f.requestId !== null ? [{ key: `req-${f.requestId}`, label: `Request ${f.requestId} · ${f.title}`, href: f.href }] : []),
      ...f.taskIds.map(t => ({ key: `task-${t}`, label: `Engineering task ${t} · ${linked.records.get(t)?.title ?? f.title}`, href: (linked.link ?? genericRecordLinker)({ objectType: 'engineering_task', id: t }) })),
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
    verification: { acceptance, deployCheck, impact },
    announcement,
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
