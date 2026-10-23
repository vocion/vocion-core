import type { RoutineInputSpec, RoutineView } from './types';
import { describe, expect, it } from 'vitest';
import { batchProgress, countChips, elapsed, exampleRows, money, parseRows, peopleTime, routineLine, routineStatusWord } from './display';

const INPUTS: RoutineInputSpec[] = [
  { name: 'email', description: 'Their work address', example: 'dana@northwind.example', key: true },
  { name: 'full_name', description: 'As on the roster', example: 'Dana Reyes' },
  { name: 'campaign', description: 'The campaign to enroll in', example: 'Q4 Phishing Refresher' },
  { name: 'admin_password', description: 'The console sign-in', secret: true },
];

describe('parseRows', () => {
  it('reads CSV under a header, matching names loosely and leaving secrets out', () => {
    const p = parseRows('Email,Full name,Campaign\ndana@northwind.example,"Reyes, Dana",Q4 Phishing Refresher\nlee@northwind.example,Lee Park,Q4 Phishing Refresher', INPUTS);

    expect(p.error).toBeNull();
    expect(p.rows).toEqual([
      { email: 'dana@northwind.example', full_name: 'Reyes, Dana', campaign: 'Q4 Phishing Refresher' },
      { email: 'lee@northwind.example', full_name: 'Lee Park', campaign: 'Q4 Phishing Refresher' },
    ]);
  });

  it('reads TSV pasted from a spreadsheet', () => {
    const p = parseRows('email\tfull_name\tcampaign\na@acme.example\tA B\tOnboarding\n', INPUTS);

    expect(p.rows).toEqual([{ email: 'a@acme.example', full_name: 'A B', campaign: 'Onboarding' }]);
  });

  it('reads a JSON array', () => {
    const p = parseRows('[{"email":"a@acme.example","full_name":"A","campaign":"X"}]', INPUTS);

    expect(p.error).toBeNull();
    expect(p.rows).toHaveLength(1);
  });

  it('leaves a missing column to the shared fields, and names an unknown one', () => {
    expect(parseRows('email,full_name\na,b', INPUTS)).toMatchObject({ error: null, columns: ['email', 'full_name'], rows: [{ email: 'a', full_name: 'b' }] });
    expect(parseRows('email,full_name,campaign,team\na,b,c,d', INPUTS).error).toMatch(/Not an input of this routine: team/);
    expect(parseRows('foo,bar\n1,2', INPUTS).error).toMatch(/header line/);
  });

  it('takes bare lines for a one-input routine', () => {
    const p = parseRows('a@acme.example\nb@acme.example', [{ name: 'email', description: 'x' }]);

    expect(p.rows).toEqual([{ email: 'a@acme.example' }, { email: 'b@acme.example' }]);
  });

  it('refuses more rows than a batch runs', () => {
    const lines = ['email', ...Array.from({ length: 201 }, (_, i) => `u${i}@acme.example`)].join('\n');

    expect(parseRows(lines, [{ name: 'email', description: 'x' }]).error).toMatch(/at most 200/);
  });

  it('writes an example from the inputs', () => {
    expect(exampleRows(INPUTS)).toBe('email,full_name,campaign\ndana@northwind.example,Dana Reyes,Q4 Phishing Refresher');
  });
});

describe('batch words', () => {
  it('leads with what needs a person', () => {
    const counts = { done: 7, waiting: 1, escalated: 1, running: 1 };

    expect(countChips(counts).map(c => c.status)).toEqual(['waiting', 'escalated', 'running', 'done']);
    expect(batchProgress(counts, 10)).toBe('7 of 10 done · 1 waiting on you · 1 escalated');
  });

  it('formats time and money', () => {
    expect(elapsed(42_000)).toBe('42s');
    expect(elapsed(185_000)).toBe('3m 05s');
    expect(elapsed(3_720_000)).toBe('1h 02m');
    expect(money(142)).toBe('$1.42');
    expect(peopleTime(0)).toBe('none');
    expect(peopleTime(180_000)).toBe('3 min');
  });
});

describe('routine words', () => {
  const base = { expert: { userId: 'u1', name: 'Dana Reyes' }, draft: null, version: null, error: null, teaching: null, stats: { runs: 0, done: 0, escalated: 0, failed: 0, lastBatchId: null } } as unknown as RoutineView;

  it('says where a routine stands', () => {
    expect(routineLine({ ...base, status: 'live', stats: { runs: 20, done: 18, escalated: 2, failed: 0, lastBatchId: 3 } })).toBe('20 runs · 18 done · 2 exceptions');
    expect(routineLine({ ...base, status: 'in_review' })).toBe('Drafted · in review with Dana Reyes');
    expect(routineLine({ ...base, status: 'teaching', teaching: { state: 'waiting_for_recording', startedAt: '', targetUrl: null, recordUrl: null, instruction: null, checks: 0, lastCheckedAt: null } })).toBe('Teaching · waiting for your recording');
    expect(routineStatusWord({ status: 'teaching', teaching: { state: 'failed', startedAt: '', targetUrl: null, recordUrl: null, instruction: null, checks: 0, lastCheckedAt: null } }).tone).toBe('fail');
  });
});
