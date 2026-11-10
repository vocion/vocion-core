import type { RoutineBatchView, RoutineSpec } from '@/libs/routines/types';
import { describe, expect, it } from 'vitest';
import { needsApproval } from '@/libs/browser/run';
import { decisionViewOf } from '@/libs/decisions/decision';
import { savingsOf } from '@/libs/routines/savings';
import { clock, momentUrl } from '@/libs/routines/types';
import { parseRows } from '@/services/agents/tools/routineTools';
import { allowedWrite } from '@/services/browser/browserLoop';
import { PRACTICE_ROUTINE_SPEC, practiceRoutineBatch } from './practice';
import { checkValue, idemKeyOf, pageShotMd, receiptFor, reportMarkdown, runDetailsUrl, runWaitAsk } from './RoutineService';
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
  it('keys a row by the automation\'s key inputs, case-insensitively', () => {
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

    expect(yaml).toContain('action: automation.run');
    expect(yaml).toContain('version: 2');
    expect(yaml).not.toContain('password');
  });
});

describe('trust in the engine', () => {
  it('holds the saves an automation makes, and lets Approved trust take only the named ones', () => {
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
  it('says results, what it saved against the baseline for what it cost, and findings', () => {
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
      tokens: 90_000,
      savings: savingsOf([
        { status: 'done', manualMinutes: 3, humanMs: 0, cents: 35, tokens: 30_000, decisions: 0, at: null },
        { status: 'skipped', manualMinutes: 3, humanMs: 90_000, cents: 35, tokens: 30_000, decisions: 1, at: null },
        { overhead: true, status: 'done', manualMinutes: null, humanMs: 0, cents: 35, tokens: 30_000, decisions: 0, at: null },
      ], null),
      sample: false,
      fields: { inputs: [], outputs: [] },
      startedAt: '2026-10-22T15:00:00Z',
      endedAt: '2026-10-22T15:03:00Z',
      runs: [
        { id: 1, batchId: 7, n: 1, label: 'Aisha Karim', status: 'done', input: {}, browserRunId: 11, browser: null, waiting: null, receipt: null, summary: 'Added and enrolled.', error: null, humanMs: 0, decisions: 0, cents: 35, tokens: 30_000, startedAt: null, endedAt: null },
        { id: 2, batchId: 7, n: 2, label: 'Tomás Ortega', status: 'skipped', input: {}, browserRunId: 12, browser: null, waiting: null, receipt: null, summary: 'The expert said to leave him.', error: null, humanMs: 90_000, decisions: 1, cents: 35, tokens: 30_000, startedAt: null, endedAt: null },
      ],
      followUp: null,
      findings: [{ id: 'f1', kind: 'not_on_list', title: '1 record in the account is not on the list', detail: 'Checked.', items: [{ name: 'QA Test', email: 'qa-test@x.example' }], askId: 3, options: [], state: 'open', answer: null, followUpBatchId: null }],
      report: null,
    };
    const md = reportMarkdown(v);

    expect(md).toContain('# Automation run 7 · Add a user');
    expect(md).toContain('**2** done and verified');
    expect(md).toContain('**Saved 3 minutes, for $1.05 of runs.**');
    expect(md).toContain('90k tokens');
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

describe('a run that stops to ask its expert', () => {
  const shot = '/api/artifacts/org-larkfield-9c1e/org-larkfield-9c1e.jpg';
  const base = { routineName: 'Enroll a provider', trustLabel: 'Approved', run: { n: 3, label: 'Dana Whitfield · Larkfield', browserRunId: 318 }, batchId: 12, batchName: 'Automation run 12' };

  it('asks the question in whole words, with the page as it stopped, and Details on that run', () => {
    const asked = runWaitAsk({ ...base, w: { kind: 'question', text: 'The Larkfield license on file expires 11/30/2026 — only renewals filed before then keep the enrollment active, so which date should I use?\n\nThe form shows two dates.', options: ['Use the renewal date', 'Leave it'], shotUrl: shot, at: '2026-11-04T15:00:00Z' } });

    expect(asked.title).toBe('Dana Whitfield: The Larkfield license on file expires 11/30/2026 — only renewals filed before then keep…');
    expect(asked.contextMd).toContain(`![The page as it stopped](${shot})`);
    expect(asked.contextMd).toContain('> The form shows two dates.');
    expect(asked.contextUrl).toBe('/dashboard/browser/318');
  });

  it('an approval hold carries the same picture and opens the same run', () => {
    const asked = runWaitAsk({ ...base, w: { kind: 'approval', text: 'Click “Submit application”', step: 'Click “Submit application”', shotUrl: shot, at: '2026-11-04T15:00:00Z' } });

    expect(asked.title).toBe('Dana Whitfield: approve “Submit application”?');
    // The words after the control's name stay outside its quotes.
    expect(runWaitAsk({ ...base, w: { kind: 'approval', text: 'x', step: 'Click “Submit application” on larkspur.example', at: '2026-11-04T15:00:00Z' } }).title).toBe('Dana Whitfield: approve “Submit application” on larkspur.example?');
    expect(runWaitAsk({ ...base, w: { kind: 'approval', text: 'Save the form', at: '2026-11-04T15:00:00Z' } }).title).toBe('Dana Whitfield: approve “Save the form”?');
    expect(asked.contextMd).toContain(`![The page as it stopped](${shot})`);
    expect(asked.contextUrl).toBe('/dashboard/browser/318');
  });

  it('an escalation in parts: its question is the title as asked, the rule the why, the facts a table, each answer with what it does', () => {
    const asked = runWaitAsk({ ...base, w: {
      kind: 'question',
      escalation: true,
      text: 'composed for older surfaces',
      question: 'Correct Owen Fitzgerald’s license number on the board to 149.021345?',
      rule: 'A license number that does not match the state lookup goes to the expert.',
      found: [{ label: 'Board says', value: 'IL LCSW 149.012345' }, { label: 'License lookup', value: 'No record for that number' }, { label: 'Name search', value: 'Owen J. Fitzgerald · LCSW 149.021345 · Active · expires 11/30/2027' }],
      choices: [{ label: 'Correct it to 149.021345', consequence: 'Updates the board record, then reads it back.' }, { label: 'Leave it', consequence: 'Nothing is saved for this provider.' }],
      options: ['Correct it to 149.021345', 'Leave it'],
      shotUrl: shot,
      at: '2026-11-04T15:00:00Z',
    } });

    expect(asked.title).toBe('Correct Owen Fitzgerald’s license number on the board to 149.021345?');
    expect(asked.body).toBe('A license number that does not match the state lookup goes to the expert. (Enroll a provider, run 3)');
    expect(asked.options).toEqual([
      { id: 'o1', label: 'Correct it to 149.021345', description: 'Updates the board record, then reads it back.', recommended: true },
      { id: 'o2', label: 'Leave it', description: 'Nothing is saved for this provider.' },
    ]);
    expect(asked.contextUrl).toBe('/dashboard/browser/318');

    const view = decisionViewOf({ id: 1, kind: 'ruling', title: asked.title, body: asked.body, contextMd: asked.contextMd, options: asked.options, status: 'open' });

    expect(view.facts).toEqual([{ label: 'Board says', value: 'IL LCSW 149.012345' }, { label: 'License lookup', value: 'No record for that number' }, { label: 'Name search', value: 'Owen J. Fitzgerald · LCSW 149.021345 · Active · expires 11/30/2027' }]);
    expect(view.picture).toEqual({ src: shot, alt: 'The page as it stopped' });
    expect(view.options[0]).toMatchObject({ label: 'Correct it to 149.021345', consequence: 'Updates the board record, then reads it back.', recommended: true });
  });

  it('an older wait with only text still asks, its options plain labels', () => {
    const asked = runWaitAsk({ ...base, w: { kind: 'question', escalation: true, text: 'Two accounts match. Which one?', options: ['The first', 'Skip it'], at: '2026-11-04T15:00:00Z' } });

    expect(asked.title).toBe('Dana Whitfield: Two accounts match.');
    expect(asked.options).toEqual([{ id: 'o1', label: 'The first', recommended: true }, { id: 'o2', label: 'Skip it' }]);
  });

  it('a run with no browser yet opens its batch, and a wait with no screenshot carries no picture', () => {
    expect(runDetailsUrl({ browserRunId: null }, 12)).toBe('/dashboard/automations/batches/12');
    expect(pageShotMd(null)).toBe('');
    expect(runWaitAsk({ ...base, w: { kind: 'question', text: 'Which date?', at: '2026-11-04T15:00:00Z' } }).contextMd).not.toContain('![');
  });
});
