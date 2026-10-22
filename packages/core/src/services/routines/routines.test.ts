import type { RoutineBatchView, RoutineSpec } from '@/libs/routines/types';
import { describe, expect, it } from 'vitest';
import { needsApproval } from '@/libs/browser/run';
import { clock, momentUrl } from '@/libs/routines/types';
import { parseRows } from '@/services/agents/tools/routineTools';
import { allowedWrite } from '@/services/browser/browserLoop';
import { PRACTICE_ROUTINE_SPEC, practiceRoutineBatch } from './practice';
import { checkValue, idemKeyOf, receiptFor, reportMarkdown } from './RoutineService';
import { compileTask, framesToRead, jsonIn, normalizeSpec, runOutputs, workflowYamlFor } from './teaching';

describe('a read-back check', () => {
  it('matches the saved value against the input it was asked for', () => {
    expect(checkValue('saved_email', 'aisha.karim@larkfield.example', 'Aisha.Karim@larkfield.example').ok).toBe(true);
    expect(checkValue('enrolled_campaign', 'Q4 Security Awareness', 'Q4 Security Awareness (CMP-301)').ok).toBe(true);
    expect(checkValue('start', '2026-11-02', 'Nov 2, 2026').ok).toBe(true);
    expect(checkValue('saved_email', 'dana.whitfield@larkfield.example', 'dwhitfield@larkfield.example').ok).toBe(false);
    expect(checkValue('saved_email', 'x@y.example', null)).toMatchObject({ ok: false, actual: null });
  });

  it('is a receipt: verified only when every check matches', () => {
    const outputs = runOutputs(PRACTICE_ROUTINE_SPEC.outputs);
    const input = { email: 'aisha.karim@larkfield.example', campaign: 'Q4 Security Awareness' };
    const good = receiptFor(input, outputs, { user_id: 'USR-4821', saved_email: 'aisha.karim@larkfield.example', enrolled_campaign: 'Q4 Security Awareness', before: 'No user with this email' }, 'the approved spec');

    expect(good).toMatchObject({ verified: true, before: 'No user with this email' });
    expect(good.after).not.toHaveProperty('before');

    const bad = receiptFor(input, outputs, { saved_email: 'aisha.karim@larkfield.example', enrolled_campaign: 'New-hire onboarding' }, 'the approved spec');

    expect(bad.verified).toBe(false);
    expect(bad.checks.find(c => c.name === 'enrolled_campaign')?.ok).toBe(false);
  });
});

describe('the dedupe ledger', () => {
  it('keys a row by the routine\'s key inputs, case-insensitively', () => {
    expect(idemKeyOf({ email: 'Aisha.Karim@larkfield.example', first_name: 'Aisha' }, PRACTICE_ROUTINE_SPEC)).toBe('email=aisha.karim@larkfield.example');
    expect(idemKeyOf({ first_name: 'Aisha' }, PRACTICE_ROUTINE_SPEC)).toBeNull();
  });
});

describe('the analyst\'s draft', () => {
  it('reads JSON from a reply, fenced or not', () => {
    expect(jsonIn('{"a":1}')).toEqual({ a: 1 });
    expect(jsonIn('Here it is:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(jsonIn('no json')).toBeNull();
  });

  it('types and bounds whatever the model wrote', () => {
    const { name, spec } = normalizeSpec({
      name: 'Add a user',
      startUrl: 'https://console.example/users',
      inputs: [{ name: 'Email', key: true }, { name: 'password', secret: true }, { name: 'Email' }],
      outputs: [{ name: 'savedEmail', checks: 'email' }, { name: 'x', checks: 'nope' }],
      steps: [{ text: 'Search', at: '14' }, { text: '' }, { text: 'Add user', at: 30 }],
      writes: [{ button: 'Add user' }, { button: '' }],
      reconcile: { listUrl: 'https://console.example/users', how: 'read it all', matchOn: 'Email' },
      questions: [{ question: 'What counts as a duplicate?', at: 26 }],
      manualMinutes: '3',
    });

    expect(name).toBe('Add a user');
    expect(spec.inputs.map(i => i.name)).toEqual(['email', 'password']);
    expect(spec.inputs[1]).toMatchObject({ secret: true, shared: true });
    expect(spec.outputs).toEqual([{ name: 'saved_email', description: '', checks: 'email' }, { name: 'x', description: '', checks: null }]);
    expect(spec.steps.map(s => [s.n, s.at])).toEqual([[1, 14], [2, 30]]);
    expect(spec.writes).toEqual([{ button: 'Add user', host: null }]);
    expect(spec.reconcile?.matchOn).toBe('email');
    expect(spec.questions[0]).toMatchObject({ id: 'q1', answer: null });
    expect(spec.manualMinutes).toBe(3);
  });

  it('looks at frames where the specialist names an action, at most eight', () => {
    const transcript = Array.from({ length: 30 }, (_, i) => ({ at: i * 10, text: i % 2 ? 'click Add user' : 'so this is the list' }));
    const at = framesToRead({ transcript, video: { durationSec: 300 } as never });

    expect(at.length).toBeLessThanOrEqual(8);
    expect(at[0]).toBe(2);
  });

  it('compiles into the brief every run is given, and a workflow', () => {
    const task = compileTask('Add a user', PRACTICE_ROUTINE_SPEC);

    expect(task).toContain('Steps, in order:');
    expect(task).toContain('The expert settled:');

    const yaml = workflowYamlFor('add-a-user', 'Add a user', 2, PRACTICE_ROUTINE_SPEC);

    expect(yaml).toContain('action: routine.run');
    expect(yaml).toContain('version: 2');
    expect(yaml).not.toContain('password');
  });
});

describe('trust in the engine', () => {
  it('holds the saves a routine makes, and lets Approved trust take only the named ones', () => {
    for (const name of ['Add user', 'Enroll', 'Deactivate user', 'Delete user', 'Launch campaign']) {
      expect(needsApproval({ role: 'button', name })).toBe(true);
    }
    for (const name of ['Search', 'Got it', 'Reactivate user', 'Sign in']) {
      expect(needsApproval({ role: 'button', name })).toBe(false);
    }

    expect(needsApproval({ role: 'link', name: 'Add user' })).toBe(false);

    const writes = PRACTICE_ROUTINE_SPEC.writes;

    expect(allowedWrite(writes, { name: 'Add user', host: 'console.lumen-awareness.test' })).toBe(true);
    expect(allowedWrite(writes, { name: 'Delete user', host: 'console.lumen-awareness.test' })).toBe(false);
    expect(allowedWrite([{ button: 'deactivate', match: 'contains' }], { name: 'Deactivate user', host: 'x' })).toBe(true);
    expect(allowedWrite([{ button: 'Enroll', host: 'a.example' }], { name: 'Enroll', host: 'b.example' })).toBe(false);
  });
});

describe('rows from chat', () => {
  it('reads CSV or tab-separated text with a header line, quotes included', () => {
    expect(parseRows('first_name,last_name,email\nAisha,Karim,aisha@x.example\n"Ruiz, Carmen",C,c@x.example')).toEqual([
      { first_name: 'Aisha', last_name: 'Karim', email: 'aisha@x.example' },
      { first_name: 'Ruiz, Carmen', last_name: 'C', email: 'c@x.example' },
    ]);
    expect(parseRows('a\tb\n1\t2')).toEqual([{ a: '1', b: '2' }]);
    expect(parseRows('just a header')).toEqual([]);
  });

  it('has the practice roster ready, with what every row shares', () => {
    const { rows, shared } = practiceRoutineBatch();

    expect(rows).toHaveLength(20);
    expect(Object.keys(shared).sort()).toEqual(['campaign', 'password', 'sign_in_email']);
  });
});

describe('the report', () => {
  it('says results, time against the baseline, cost and findings', () => {
    const v: RoutineBatchView = {
      id: 7,
      routine: { id: 1, name: 'Add a user', version: 1, trust: 'approved', expert: 'Chris' },
      requestedBy: 'Chris',
      conversationId: null,
      status: 'done',
      counts: { done: 2, skipped: 1 },
      total: 3,
      cents: 105,
      humanMs: 90_000,
      manualMinutes: 3,
      startedAt: '2026-10-22T15:00:00Z',
      endedAt: '2026-10-22T15:03:00Z',
      runs: [
        { id: 1, batchId: 7, n: 1, label: 'Aisha Karim', status: 'done', input: {}, browserRunId: 11, browser: null, waiting: null, receipt: null, summary: 'Added and enrolled.', error: null, humanMs: 0, cents: 35, startedAt: null, endedAt: null },
        { id: 2, batchId: 7, n: 2, label: 'Tomás Ortega', status: 'skipped', input: {}, browserRunId: 12, browser: null, waiting: null, receipt: null, summary: 'The expert said to leave him.', error: null, humanMs: 90_000, cents: 35, startedAt: null, endedAt: null },
      ],
      findings: [{ id: 'f1', kind: 'not_on_list', title: '1 record in the account is not on the list', detail: 'Checked.', items: [{ name: 'QA Test', email: 'qa-test@x.example' }], askId: 3, options: [], state: 'open', answer: null, followUpBatchId: null }],
      report: null,
    };
    const md = reportMarkdown(v);

    expect(md).toContain('# Routine batch 7 · Add a user');
    expect(md).toContain('**2** done and verified');
    expect(md).toContain('about 6 min');
    expect(md).toContain('$1.05 in total');
    expect(md).toContain('[2](/dashboard/browser/12)');
    expect(md).toContain('Finding: 1 record in the account is not on the list');
    expect(md).toContain('| QA Test | qa-test@x.example |');
  });
});

describe('moments on the recording', () => {
  it('read as people write them, and link into the player', () => {
    expect(clock(83)).toBe('1:23');
    expect(clock(null)).toBe('');
    expect(momentUrl('https://slate.metacto.com/v/abc', 83)).toBe('https://slate.metacto.com/v/abc?t=83');
  });
});

void ({} as RoutineSpec);

describe('where the work starts', () => {
  it('is asked of the expert when the recording does not show it, and their answer sets it', async () => {
    const { normalizeSpec, settleAnswers } = await import('./teaching');
    const { spec } = normalizeSpec({ steps: [{ text: 'Search', at: 1 }] });

    expect(spec.startUrl).toBeNull();
    expect(spec.questions[0]?.id).toBe('start');

    const answered = settleAnswers({ ...spec, questions: spec.questions.map(q => ({ ...q, answer: 'It is https://staging.example.com/users' })) });

    expect(answered.startUrl).toBe('https://staging.example.com/users');
    expect(answered.systems).toContain('staging.example.com');
  });
});
