import type { FeatureReportInput, ReportObject } from './featureReport';
import type { PageRow } from '@/libs/workspace/pageFields';
import type { LinkedRecord, ReleaseLinked } from '@/libs/workspace/releaseFeed';
import { describe, expect, it } from 'vitest';
import { featureProof, PLAN_RISK_PREFIX, proofLine } from '@/libs/workspace/featureProof';
import { readRelease } from '@/libs/workspace/releaseFeed';
import { featureDrawer } from './featureDrawer';
import { assembleFeatureReport } from './featureReport';
import { assembleReleaseReport } from './releaseReport';

/**
 * ONE COUNT, EVERY SURFACE. Shaped like a feature that shipped on 2026-09-28
 * and read "QA approved, 8 of 8 criteria proven" on its Releases row and
 * "Acceptance · 0 of 6 verified" on its own page: six acceptance lines on the
 * request, two plan-risk lines the dispatch added to the task's contract, an
 * attempt QA approved that shipped, and a newer attempt nobody judged.
 * Fictional: Relay is a Northwind product; URLs are `.example`.
 */

const NOW = new Date('2026-09-28T12:00:00Z');
const shot = (n: number) => `https://relay.example/dashboard/artifacts/${n}`;

const ACCEPTANCE = [
  'Files over 8 MB upload in parts; a dropped part is retried, not the whole file.',
  'Losing signal shows No signal · N% kept · retrying, and resumes by itself when signal returns.',
  'After 2 minutes offline it stops with Retry from N%, which reuses the parts already sent.',
  'The percentage counts only confirmed parts, so it never goes backwards.',
  'Request-link uploads on /r/ get the same behaviour.',
  'Abandoned partial uploads are cleaned up within 24 hours.',
];
const RISKS = [`${PLAN_RISK_PREFIX}Orphaned parts: lifecycle rule.`, `${PLAN_RISK_PREFIX}CORS must expose ETag for the browser to read part results.`];
const CONTRACT = [...ACCEPTANCE, ...RISKS];

const verdict = {
  value: 'approve',
  by: 'change-reviewer',
  at: '2026-09-28T07:58:00Z',
  proven: 8,
  total: 8,
  criteria: CONTRACT.map((criterion, i) => ({ criterion, status: 'proven', evidence: `Screenshot ${shot(1250 + i)} shows it. Named test run ${shot(1299)} passes.` })),
};

/** The request as the release pack left it: `met` with prose `evidence`, never `evidenceUrl`. */
const markedAcceptance = ACCEPTANCE.map((statement, i) => ({ statement, met: true, evidence: verdict.criteria[i]!.evidence }));

const request = (acceptance: unknown[]): ReportObject => ({
  id: 41,
  title: 'Uploads that survive a bad connection',
  status: 'approved',
  createdAt: new Date('2026-09-25T22:00:00Z'),
  meta: { kind: 'bug', state: 'shipped', acceptance, acceptanceFrozenAt: '2026-09-28T03:22:09Z', shippedAt: '2026-09-28T08:12:46Z', shippedIn: 70, outcome: 'Upload a large file on a phone, lose signal, and have it pick up where it stopped.' },
});

const shipped: ReportObject = {
  id: 52,
  title: 'Uploads that survive a bad connection',
  status: 'accepted',
  createdAt: new Date('2026-09-28T07:23:10Z'),
  meta: { requestId: 41, status: 'accepted', prUrl: 'https://github.example/northwind/relay/pull/96', commitSha: '930a23f6ebbd', acceptanceContract: CONTRACT, verdict },
};
/** A later attempt: carries the same contract, and QA never judged it. */
const newer: ReportObject = {
  id: 53,
  title: 'Uploads that survive a bad connection',
  status: 'queued',
  createdAt: new Date('2026-09-28T09:00:00Z'),
  meta: { requestId: 41, status: 'queued', acceptanceContract: CONTRACT },
};
/** An earlier attempt QA sent back. */
const earlier: ReportObject = {
  id: 50,
  title: 'Uploads that survive a bad connection',
  status: 'abandoned',
  createdAt: new Date('2026-09-28T03:22:09Z'),
  meta: { requestId: 41, status: 'abandoned', acceptanceContract: CONTRACT, verdict: { value: 'changes', proven: 1, total: 8, criteria: CONTRACT.map((criterion, i) => ({ criterion, status: i === 0 ? 'proven' : 'unproven', ...(i === 0 ? { evidence: shot(1100) } : {}) })) } },
};

const releaseRow: PageRow = {
  id: 70,
  title: 'relay 930a23f6ebbd',
  status: 'active',
  createdAt: new Date('2026-09-28T08:12:46Z'),
  meta: {
    product: 'relay',
    version: '930a23f6ebbd',
    releasedAt: '2026-09-28T08:12:46Z',
    healthAfter: 'ok',
    healthCheckedAt: '2026-09-28T08:12:46Z',
    commits: ['930a23f logic: Uploads that survive a bad connection (#96)'],
    prUrls: ['https://github.example/northwind/relay/pull/96'],
    taskIds: [52],
    requestIds: [41],
    evidence: [{ taskId: 52, requestId: 41, prUrl: 'https://github.example/northwind/relay/pull/96', verdict: 'approve, 8 of 8 proven', title: 'Uploads that survive a bad connection' }],
  },
};

const asLinked = (o: ReportObject, type: string): LinkedRecord => ({ id: o.id, type, title: o.title, meta: o.meta });

function surfaces(acceptance: unknown[]) {
  const req = request(acceptance);
  const input: FeatureReportInput = {
    request: req,
    tasks: [earlier, shipped, newer],
    plans: [],
    workerRuns: [],
    asks: [],
    actionRuns: [],
    releases: [{ id: 70, title: releaseRow.title, status: 'active', createdAt: releaseRow.createdAt ?? null, meta: releaseRow.meta! }],
    artifacts: [],
    now: NOW,
  };
  // The release reads only the task it shipped, as `loadReleaseLinked` loads it.
  const linked: ReleaseLinked = { records: new Map([[41, asLinked(req, 'request')], [52, asLinked(shipped, 'engineering_task')]]), products: new Map([['relay', 'Relay']]) };
  return {
    feature: assembleFeatureReport(input),
    reading: readRelease(releaseRow, { linked, now: NOW }),
    page: assembleReleaseReport(releaseRow, { linked, now: NOW }),
  };
}

describe('featureProof', () => {
  it('counts the attempt that shipped, not a newer attempt QA never judged, and keeps plan risks as their own group', () => {
    const proof = featureProof({ request: request(markedAcceptance), tasks: [earlier, shipped, newer], shippedTaskIds: [52] });

    expect(proof.attempt).toMatchObject({ taskId: 52, why: 'shipped', verdict: 'approve' });
    expect({ proven: proof.proven, total: proof.total, risksHandled: proof.risksHandled, risksTotal: proof.risksTotal }).toEqual({ proven: 6, total: 6, risksHandled: 2, risksTotal: 2 });
    expect(proof.acceptance.map(c => c.statement)).toEqual(ACCEPTANCE);
    expect(proof.risks.map(c => c.statement)).toEqual(RISKS);
    expect(proof.acceptance[0]).toMatchObject({ state: 'passed', from: 'verdict', evidenceUrl: shot(1250) });
    expect(proofLine(proof)).toBe('6 of 6 acceptance criteria proven · 2 plan risks handled');
  });

  it('does not depend on the release pack having marked the request: an unmarked request reads the same', () => {
    const unmarked = featureProof({ request: request(ACCEPTANCE.map(statement => ({ statement }))), tasks: [earlier, shipped, newer], shippedTaskIds: [52] });

    expect([unmarked.proven, unmarked.total, unmarked.risksHandled, unmarked.risksTotal]).toEqual([6, 6, 2, 2]);
  });

  it('with nothing shipped, reads the newest judged attempt, and a line QA found unproven is failed', () => {
    const proof = featureProof({ request: request(ACCEPTANCE.map(statement => ({ statement }))), tasks: [earlier, newer] });

    expect(proof.attempt).toMatchObject({ taskId: 50, why: 'judged', verdict: 'changes' });
    expect([proof.proven, proof.total, proof.risksHandled, proof.risksTotal]).toEqual([1, 6, 0, 2]);
    expect(proof.acceptance[1]!.state).toBe('failed');
    expect(proofLine(proof)).toBe('1 of 6 acceptance criteria proven · 0 of 2 plan risks handled');
  });

  it('with no attempt judged, a person\'s own mark with evidence still counts, and a bare mark does not', () => {
    const proof = featureProof({ request: request([{ statement: ACCEPTANCE[0], met: true, evidence: `Checked on a phone: ${shot(9)}` }, { statement: ACCEPTANCE[1], met: true }]), tasks: [newer] });

    expect(proof.attempt).toBeNull();
    expect(proof.acceptance.map(c => c.state)).toEqual(['passed', 'unverified']);
    expect(proof.acceptance[1]!.note).toBe('Marked met, with no evidence attached.');
    expect(proof.risks.map(c => c.state)).toEqual(['unverified', 'unverified']);
  });
});

describe('the feature page and the release say the same count', () => {
  for (const [label, acceptance] of [['as the release pack marked it', markedAcceptance], ['with the pack\'s write missing', ACCEPTANCE.map(statement => ({ statement }))]] as const) {
    it(`reads 8 of 8 (6 acceptance, 2 plan risks) on every surface, ${label}`, () => {
      const { feature, reading, page } = surfaces([...acceptance]);

      // The feature page: acceptance section, the implementation fact, the drawers.
      expect(feature.acceptance).toMatchObject({ verified: 6, total: 6, risksHandled: 2, risksTotal: 2, risksLine: '2 plan risks handled', attempt: { taskId: 52, why: 'shipped' } });
      expect(feature.acceptance.items.every(c => c.state === 'passed')).toBe(true);
      expect(feature.implementation.ladder.find(s => s.key === 'acceptance')).toMatchObject({ value: '6 of 6 · 2 plan risks handled', state: 'yes' });

      const drawer = featureDrawer(feature, 'acceptance');

      expect(drawer?.subtitle).toMatch(/^6 of 6 verified · 2 plan risks handled/);
      expect(featureDrawer(feature, 'criterion-0')?.body).toContain(shot(1250));
      expect(featureDrawer(feature, 'criterion-7')?.subtitle).toBe(RISKS[1]);

      // The release row and the release page.
      expect(reading.features[0]!.verdict).toMatchObject({ value: 'approve', proven: 6, total: 6, risksHandled: 2, risksTotal: 2 });
      expect(reading.verification.acceptance?.line).toBe('QA approved, 8 of 8 criteria proven (6 acceptance, 2 plan risks)');
      expect(page.verification.acceptance[0]!.line).toBe('QA approved, 8 of 8 criteria proven (6 acceptance, 2 plan risks) (change-reviewer)');
    });
  }
});
