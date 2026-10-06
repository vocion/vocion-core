import { describe, expect, it } from 'vitest';
import { featureProof, LEFT_TO_LIVE_NOTE, PLAN_RISK_PREFIX, risksLine } from './featureProof';

/**
 * A LINE QA LEFT TO THE LIVE CHECK (FE-392, 2026-10-03): QA approved six of seven lines and marked
 * one plan-risk line `live` ("only the running product can show this; the live check proves it").
 * The live check then saw 4 of 4 states, but never that line, and the page read it "Unverified".
 * Fictional: Kestrel is a Northwind product; URLs are `.example`.
 */

const ACCEPTANCE = [
  'The document title shows a Shared badge when a link is live.',
  'The badge opens the share panel.',
];
const RISK_LIVE = `${PLAN_RISK_PREFIX}The title line already wraps the title plus two badges; a third badge must not push the menu off the row on a phone.`;
const RISK_PROVEN = `${PLAN_RISK_PREFIX}The badge reads its state from the share record, not a cached flag.`;

const task = {
  id: 77,
  meta: {
    requestId: 12,
    acceptanceContract: [...ACCEPTANCE, RISK_LIVE, RISK_PROVEN],
    verdict: {
      value: 'approve',
      at: '2026-10-02T09:00:00Z',
      by: 'change-reviewer',
      criteria: [
        ...ACCEPTANCE.map(criterion => ({ criterion, status: 'proven', evidence: 'Screenshot https://kestrel.example/a/1 shows it.' })),
        { criterion: RISK_LIVE, status: 'live' },
        { criterion: RISK_PROVEN, status: 'proven', evidence: 'Named test https://ci.example/run/4 passes.' },
      ],
    },
  },
};

const request = (liveCheck?: Record<string, unknown>) => ({ id: 12, meta: { acceptance: ACCEPTANCE.map(statement => ({ statement })), ...(liveCheck ? { liveCheck } : {}) } });
const flow = (line: number, criterion: string) => ({ name: `line ${line}`, phase: 'check', line, criterion, path: '/documents', viewports: ['phone'], steps: [] });

describe('a line QA left to the live check', () => {
  it('reads "left to the live check; not checked yet" before any live check, never a bare unverified', () => {
    const proof = featureProof({ request: request(), tasks: [task], shippedTaskIds: [77] });

    expect(proof.risks[0]).toMatchObject({ statement: RISK_LIVE, state: 'unverified', leftToLive: true, note: LEFT_TO_LIVE_NOTE });
    expect(proof.risksHandled).toBe(1);
    expect(risksLine(proof)).toBe('1 of 2 plan risks handled');
  });

  it('passes, with the live check as its evidence, when a check flow cited its words and saw it', () => {
    const proof = featureProof({
      request: request({
        state: 'seen',
        releaseId: 410,
        checkedAt: '2026-10-03T08:00:00Z',
        flows: [flow(1, ACCEPTANCE[0]!), flow(2, ACCEPTANCE[1]!), flow(3, `  ${RISK_LIVE.replace(/ /g, '  ')} `)],
        lines: [
          { line: 1, text: ACCEPTANCE[0], result: 'reached', url: 'https://kestrel.example/documents/9', reason: null },
          { line: 3, text: RISK_LIVE, result: 'reached', url: 'https://kestrel.example/documents/9', reason: null },
        ],
      }),
      tasks: [task],
      shippedTaskIds: [77],
    });

    expect(proof.risks[0]).toMatchObject({ state: 'passed', from: 'live', leftToLive: true, evidenceUrl: 'https://kestrel.example/documents/9', note: null });
    expect(proof.risks[0]!.evidence).toBe('Seen live by the live check of release #410 (2026-10-03). https://kestrel.example/documents/9');
    expect(proof.risksHandled).toBe(2);
    expect(risksLine(proof)).toBe('2 plan risks handled');
    // QA's own proof of the acceptance lines is untouched.
    expect(proof.acceptance.map(c => [c.state, c.from])).toEqual([['passed', 'verdict'], ['passed', 'verdict']]);
  });

  it('a check recorded before it kept each line: a fully seen check whose flow cited the words passed it', () => {
    const proof = featureProof({ request: request({ state: 'seen', releaseId: 410, flows: [flow(3, `  ${RISK_LIVE.replace(/ /g, '  ')} `)] }), tasks: [task], shippedTaskIds: [77] });

    expect(proof.risks[0]).toMatchObject({ state: 'passed', from: 'live' });
  });

  it('stays "not checked yet" when the live check saw everything it looked at but never this line', () => {
    const proof = featureProof({
      request: request({ state: 'seen', releaseId: 410, flows: [flow(1, ACCEPTANCE[0]!), flow(2, ACCEPTANCE[1]!)], lines: [{ line: 1, text: ACCEPTANCE[0], result: 'reached', url: null, reason: null }] }),
      tasks: [task],
      shippedTaskIds: [77],
    });

    expect(proof.risks[0]).toMatchObject({ state: 'unverified', note: LEFT_TO_LIVE_NOTE, leftToLive: true });
    expect(proof.risksHandled).toBe(1);
  });

  it('fails, saying why, when the live check did not reach it; and says so when it was named as not checkable', () => {
    const failed = featureProof({
      request: request({ state: 'partial', releaseId: 410, flows: [flow(3, RISK_LIVE)], lines: [{ line: 3, text: RISK_LIVE, result: 'not_reached', url: null, reason: 'the menu was not visible at phone width' }] }),
      tasks: [task],
      shippedTaskIds: [77],
    });

    expect(failed.risks[0]).toMatchObject({ state: 'failed', from: 'live', note: 'Not seen by the live check of release #410: the menu was not visible at phone width' });

    const unchecked = featureProof({
      request: request({ state: 'seen', releaseId: 410, flows: [], lines: [{ line: 3, text: RISK_LIVE, result: 'not_checked', url: null, reason: 'cannot be seen' }] }),
      tasks: [task],
      shippedTaskIds: [77],
    });

    expect(unchecked.risks[0]).toMatchObject({ state: 'unverified', note: 'The live check of release #410 did not check this line on the live product.' });
  });
});
