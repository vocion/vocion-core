import type { RoutineBatchView, RoutineRunView } from './types';
import { describe, expect, it } from 'vitest';
import { batchTable, columnLabel, rowStatus } from './batchTable';

function run(n: number, over: Partial<RoutineRunView> = {}): RoutineRunView {
  return {
    id: 100 + n,
    batchId: 4,
    n,
    label: `Person ${n} · Q4 Refresher`,
    status: 'queued',
    input: { email: `p${n}@northwind.example`, full_name: `Person ${n}`, campaign: 'Q4 Refresher', team: 'Ops' },
    browserRunId: null,
    browser: null,
    waiting: null,
    receipt: null,
    summary: null,
    error: null,
    humanMs: 0,
    cents: 0,
    startedAt: null,
    endedAt: null,
    ...over,
  };
}

const receipt = (email: string, ok = true): NonNullable<RoutineRunView['receipt']> => ({
  requested: { email },
  before: null,
  after: { user_email: ok ? email : 'someone@else.example', enrolled_in: 'Q4 Refresher' },
  checks: [{ name: 'email', expected: email, actual: ok ? email : 'someone@else.example', ok }],
  verified: ok,
  approvedBy: 'the approved spec',
  at: '2026-11-04T10:00:00Z',
});

function batch(runs: RoutineRunView[]): Pick<RoutineBatchView, 'runs' | 'fields' | 'routine'> {
  return {
    routine: { id: 7, name: 'Add a user', version: 2, trust: 'approved', expert: 'Dana Reyes' },
    fields: {
      inputs: [{ name: 'full_name', key: false }, { name: 'campaign', key: false }, { name: 'team', key: false }, { name: 'email', key: true }],
      outputs: [{ name: 'user_email', checks: 'email' }, { name: 'enrolled_in', checks: null }],
    },
    runs,
  };
}

describe('a batch as a table', () => {
  it('shows the inputs that tell rows apart, key first, and not what the label or every row already says', () => {
    const t = batchTable(batch([run(1), run(2), run(3)]));

    // full_name is in the label, campaign is in the label and shared, team is the same for every row.
    expect(t.inputs).toEqual(['email']);
    expect(t.rows.map(r => r.inputs)).toEqual([['p1@northwind.example'], ['p2@northwind.example'], ['p3@northwind.example']]);
  });

  it('keeps a lone row\'s inputs, since nothing shows they are shared', () => {
    expect(batchTable(batch([run(1)])).inputs).toEqual(['email', 'team']);
  });

  it('adds an output column only once some row has read it back, and marks a failed read-back', () => {
    const queued = batchTable(batch([run(1), run(2)]));

    expect(queued.outputs).toEqual([]);
    expect(queued.summary).toBe(false);

    const t = batchTable(batch([
      run(1, { status: 'done', receipt: receipt('p1@northwind.example') }),
      run(2, { status: 'done', receipt: receipt('p2@northwind.example', false) }),
      run(3, { status: 'running', browserRunId: 9, browser: { status: 'running', step: 'Typed the email', why: null, steps: 3, live: true, frameSeq: 1, url: null, finalShotUrl: null } }),
    ]));

    expect(t.outputs).toEqual(['user_email', 'enrolled_in']);
    expect(t.rows[0]!.results).toEqual([{ text: 'p1@northwind.example', off: false }, { text: 'Q4 Refresher', off: false }]);
    expect(t.rows[1]!.results[0]).toEqual({ text: 'someone@else.example', off: true });
    expect(t.rows[2]!.results).toEqual([{ text: '', off: false }, { text: '', off: false }]);
  });

  it('falls back to each done row\'s summary when the spec reads nothing back', () => {
    const b = batch([run(1, { status: 'done', summary: 'Added and enrolled.' }), run(2)]);
    const t = batchTable({ ...b, fields: { ...b.fields, outputs: [] } });

    expect(t.summary).toBe(true);
    expect(t.rows.map(r => r.result)).toEqual(['Added and enrolled.', null]);
  });
});

describe('where a row stands', () => {
  it('says the step a working run is on, and what a waiting one asks', () => {
    expect(rowStatus(run(1, { status: 'running', browser: { status: 'running', step: 'Opened Add user', why: null, steps: 2, live: true, frameSeq: 1, url: null, finalShotUrl: null } }), null)).toMatchObject({ word: 'Working', detail: 'Opened Add user', tone: 'amber', pulse: true });
    expect(rowStatus(run(1, { status: 'running' }), null).detail).toBe('Opening the browser');
    expect(rowStatus(run(1, { status: 'waiting', waiting: { kind: 'question', text: 'Reactivate them?\nThey were deactivated in May.', options: [], askId: 3 } }), null)).toMatchObject({ word: 'Waiting on you', detail: 'Reactivate them?' });
    expect(rowStatus(run(1, { status: 'escalated', waiting: { kind: 'escalation', text: 'Already enrolled.', options: [], askId: 4 } }), 'Dana Reyes')).toMatchObject({ word: 'Escalated to Dana', detail: 'Already enrolled.' });
  });

  it('tells verified from not read back, and says why a run failed', () => {
    expect(rowStatus(run(1, { status: 'done', receipt: receipt('a@northwind.example') }), null)).toMatchObject({ word: 'Done · verified', tone: 'pass' });
    expect(rowStatus(run(1, { status: 'done', receipt: receipt('a@northwind.example', false) }), null)).toMatchObject({ word: 'Done · did not read back', tone: 'fail' });
    expect(rowStatus(run(1, { status: 'done' }), null).word).toBe('Done');
    expect(rowStatus(run(1, { status: 'failed', error: 'Signed out mid-save.' }), null)).toMatchObject({ word: 'Failed', detail: 'Signed out mid-save.', tone: 'fail' });
    expect(rowStatus(run(1, { status: 'skipped', summary: 'Done in run 3.' }), null)).toMatchObject({ word: 'Already done', detail: 'Done in run 3.' });
    expect(rowStatus(run(1), null)).toMatchObject({ word: 'Queued', detail: null });
  });
});

it('names a column as a header reads it', () => {
  expect(columnLabel('full_name')).toBe('Full name');
  expect(columnLabel('start-date')).toBe('Start date');
});
