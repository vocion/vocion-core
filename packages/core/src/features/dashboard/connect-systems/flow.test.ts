/**
 * The walk-through's rules, without a browser: at most one question, one
 * system at a time, verified before the next, Later and Skip and Stop, and a
 * summary that says what became of each.
 */
import type { FlowState } from './flow';
import type { ConnectCandidate, ConnectPlan } from '@/libs/connect/systemsPlan';
import { describe, expect, it } from 'vitest';
import { INITIAL, progressOf, reduce, resumeOf, summaryLine } from './flow';

function candidate(connector: string, method: ConnectCandidate['method']['kind'] = 'key'): ConnectCandidate {
  const methods: Record<string, ConnectCandidate['method']> = {
    key: { kind: 'key', credentialLabel: 'API key', credentialFields: [{ name: 'apiKey', label: 'API key', secret: true, optional: false, hint: '' }], configFields: [], getItAt: null },
    login: { kind: 'login', startHref: `/api/connect/x/start?connector=${connector}`, providerLabel: 'Vendor', settingsAfterLogin: [] },
    page: { kind: 'page', href: `/dashboard/connectors?add=${connector}` },
  };
  return { connector, name: connector.toUpperCase(), score: 50, recommended: true, evidence: [{ kind: 'named' }], method: methods[method]!, unlocks: [] };
}

function plan(over: Partial<ConnectPlan> = {}): ConnectPlan {
  return { candidates: [candidate('alpha', 'login'), candidate('beta'), candidate('gamma')], connected: [], question: null, scope: null, refused: null, ...over };
}

const walkOf = (s: FlowState) => s as Extract<FlowState, { phase: 'walk' }>;

describe('the walk-through', () => {
  it('walks straight away when nothing needs asking, with a progress line', () => {
    const s = reduce(INITIAL, { type: 'loaded', plan: plan() });

    expect(s.phase).toBe('walk');
    expect(progressOf(s)).toEqual({ index: 0, total: 3 });
  });

  it('asks the one question, then walks only what was picked, in ranked order', () => {
    const asked = reduce(INITIAL, { type: 'loaded', plan: plan({ question: { question: 'Which of these do you use?', options: ['alpha', 'beta', 'gamma'] } }) });

    expect(asked.phase).toBe('question');

    const s = walkOf(reduce(asked, { type: 'answered', connectors: ['gamma', 'alpha'] }));

    expect(s.queue.map(c => c.connector)).toEqual(['alpha', 'gamma']);
  });

  it('verifies before moving on: a login returns, is checked, and only then is the next system up', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan() });
    s = reduce(s, { type: 'connect' });

    expect(walkOf(s).step.at).toBe('authorizing');

    s = reduce(s, { type: 'login_returned', ok: true, needsSettings: false });

    expect(walkOf(s).step.at).toBe('verifying');
    expect(walkOf(s).index).toBe(0);

    s = reduce(s, { type: 'verified', result: { state: 'verified', preview: 'Found 1,284 deals', checks: [] } });

    expect(walkOf(s).index).toBe(1);
    expect(walkOf(s).outcomes).toEqual({ alpha: 'connected' });
    expect(walkOf(s).previews.alpha).toBe('Found 1,284 deals');
  });

  it('asks for the settings a login still needs before checking it', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan() });
    s = reduce(reduce(s, { type: 'connect' }), { type: 'login_returned', ok: true, needsSettings: true });

    expect(walkOf(s).step.at).toBe('settings');

    s = reduce(s, { type: 'saved' });

    expect(walkOf(s).step.at).toBe('verifying');
  });

  it('types a key inline, then checks it', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan({ candidates: [candidate('beta')] }) });
    s = reduce(s, { type: 'connect' });

    expect(walkOf(s).step.at).toBe('key');

    s = reduce(s, { type: 'back' });

    expect(walkOf(s).step.at).toBe('choose');

    s = reduce(reduce(s, { type: 'connect' }), { type: 'saved' });

    expect(walkOf(s).step.at).toBe('verifying');
  });

  it('a failed check stays on the system with its reason, to try again or put off', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan() });
    s = reduce(reduce(s, { type: 'connect' }), { type: 'login_returned', ok: false, reason: 'The login was declined at the vendor.' });

    expect(walkOf(s).step).toEqual({ at: 'failed', reason: 'The login was declined at the vendor.' });

    s = reduce(s, { type: 'connect' });

    expect(walkOf(s).step.at).toBe('authorizing');

    s = reduce(reduce(s, { type: 'login_returned', ok: true, needsSettings: false }), { type: 'verified', result: { state: 'failed', reason: 'It has no live login.' } });
    s = reduce(s, { type: 'skip' });

    expect(walkOf(s).outcomes.alpha).toBe('failed');
  });

  it('Skip and Later settle a system and move on; the last one ends in the summary', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan() });
    s = reduce(s, { type: 'skip' });
    s = reduce(s, { type: 'later' });
    s = reduce(s, { type: 'skip' });

    expect(s.phase).toBe('summary');
    expect(summaryLine(s as Extract<FlowState, { phase: 'summary' }>)).toBe('Nothing connected · later: BETA · skipped: ALPHA, GAMMA.');
  });

  it('Stop ends the walk where it stands and leaves the rest for later', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan() });
    s = reduce(reduce(reduce(s, { type: 'connect' }), { type: 'login_returned', ok: true, needsSettings: false }), { type: 'verified', result: { state: 'reading', preview: 'Found 12 documents' } });
    s = reduce(s, { type: 'stop' });

    expect(s.phase).toBe('summary');
    expect(summaryLine(s as Extract<FlowState, { phase: 'summary' }>)).toBe('Connected ALPHA · later: BETA, GAMMA.');
  });

  it('ignores what does not fit the step, so a late event cannot skip a check', () => {
    const s = reduce(INITIAL, { type: 'loaded', plan: plan() });

    expect(reduce(s, { type: 'verified', result: { state: 'verified', preview: null, checks: [] } })).toBe(s);
    expect(reduce(s, { type: 'saved' })).toBe(s);
  });

  it('says why when nothing can be connected here, and when everything already is', () => {
    expect(reduce(INITIAL, { type: 'loaded', plan: plan({ refused: 'Only a workspace admin can connect a source' }) }).phase).toBe('refused');
    expect(reduce(INITIAL, { type: 'loaded', plan: plan({ candidates: [] }) }).phase).toBe('nothing');
  });
});

/**
 * A reload, or Review in the drawer and back, mid-walk (founder, 2026-10-09,
 * at "3 of 5"): the walk picks up where it was, never back at the first system.
 */
describe('a walk picked up again', () => {
  it('keeps what each system came to and resumes at the first one still open', () => {
    let s = reduce(INITIAL, { type: 'loaded', plan: plan() });
    s = reduce(s, { type: 'later' });
    s = reduce(s, { type: 'skip' });
    const kept = resumeOf(s)!;

    expect(kept).toEqual({ picked: ['alpha', 'beta', 'gamma'], outcomes: { alpha: 'later', beta: 'skipped' } });

    const again = walkOf(reduce(INITIAL, { type: 'loaded', plan: plan(), resume: kept }));

    expect(progressOf(again)).toEqual({ index: 2, total: 3 });
    expect(again.queue[again.index]!.connector).toBe('gamma');
    expect(again.outcomes).toEqual({ alpha: 'later', beta: 'skipped' });
  });

  it('walks the same systems after the question, without asking it again', () => {
    const resumed = walkOf(reduce(INITIAL, {
      type: 'loaded',
      plan: plan({ question: { question: 'Which of these do you use?', options: ['alpha', 'beta', 'gamma'] } }),
      resume: { picked: ['alpha', 'gamma'], outcomes: { alpha: 'skipped' } },
    }));

    expect(resumed.phase).toBe('walk');
    expect(resumed.queue.map(c => c.connector)).toEqual(['alpha', 'gamma']);
    expect(progressOf(resumed)).toEqual({ index: 1, total: 2 });
  });

  it('drops a system that connected meanwhile, and goes to the summary when nothing is left', () => {
    const s = reduce(INITIAL, { type: 'loaded', plan: plan({ candidates: [candidate('beta')] }), resume: { picked: ['alpha', 'beta'], outcomes: { beta: 'later' } } });

    expect(s.phase).toBe('summary');
  });

  it('asks the question as before when it was never answered', () => {
    const s = reduce(INITIAL, { type: 'loaded', plan: plan({ question: { question: 'Which of these do you use?', options: ['alpha'] } }), resume: { outcomes: {} } });

    expect(s.phase).toBe('question');
  });
});
