import { describe, expect, it } from 'vitest';
import { REAL_DATA_SHAPES } from '../../libs/fixtures/realDataGuard';
import {
  PRACTICE_CONSOLE_CAMPAIGNS,
  PRACTICE_CONSOLE_DEPARTMENTS,
  PRACTICE_CONSOLE_ORIGIN,
  PRACTICE_CONSOLE_ROLES,
  PRACTICE_CONSOLE_ROSTER,
  PRACTICE_CONSOLE_ROSTER_CAMPAIGN,
  PRACTICE_CONSOLE_SIGN_IN,
  PRACTICE_CONSOLE_TASK_EXAMPLE,
  PRACTICE_CONSOLE_USERS,
  practiceConsoleResponse,
} from './practiceConsole';
import { PRACTICE_ORIGIN, practiceResponse } from './practiceSite';

const fullName = (u: { first: string; last: string }) => `${u.first} ${u.last}`;
const rosterEmails = new Set(PRACTICE_CONSOLE_ROSTER.map(r => r.email));
const byEmail = (email: string) => PRACTICE_CONSOLE_USERS.find(u => u.email === email);
const q4 = PRACTICE_CONSOLE_CAMPAIGNS.find(c => c.id === PRACTICE_CONSOLE_ROSTER_CAMPAIGN.id)!;
const inQ4 = (userId: string) => q4.enrolled.some(e => e.user === userId);

describe('the practice console', () => {
  it('answers every path on its own origin with the one page, and nothing else', () => {
    expect(practiceConsoleResponse(`${PRACTICE_CONSOLE_ORIGIN}/login`)?.status).toBe(200);
    expect(practiceConsoleResponse(`${PRACTICE_CONSOLE_ORIGIN}/users/USR-1033`)?.body).toContain('dwhitfield@larkfield.example');
    expect(practiceConsoleResponse(`${PRACTICE_CONSOLE_ORIGIN}/favicon.ico`)?.status).toBe(404);
    expect(practiceConsoleResponse(`${PRACTICE_ORIGIN}/login`)).toBeNull();
    expect(practiceConsoleResponse('https://example.com/login')).toBeNull();
    expect(practiceConsoleResponse('not a url')).toBeNull();
  });

  it('is served through the practice-site router, which still serves Fernhill', () => {
    expect(practiceResponse(`${PRACTICE_CONSOLE_ORIGIN}/users`)?.body).toContain('Lumen Awareness');
    expect(practiceResponse(`${PRACTICE_ORIGIN}/invoices`)?.body).toContain('Fernhill Supply');
    expect(practiceResponse('https://console.lumen-awareness.example/users')).toBeNull();
  });

  it('says on the page that it is a practice site', () => {
    expect(practiceConsoleResponse(`${PRACTICE_CONSOLE_ORIGIN}/users`)?.body).toContain('Practice site · fictional data');
  });

  it('seeds users and campaigns that agree with each other', () => {
    const ids = new Set(PRACTICE_CONSOLE_USERS.map(u => u.id));

    expect(ids.size).toBe(PRACTICE_CONSOLE_USERS.length);
    expect(new Set(PRACTICE_CONSOLE_USERS.map(u => u.email)).size).toBe(PRACTICE_CONSOLE_USERS.length);

    for (const u of PRACTICE_CONSOLE_USERS) {
      expect(u.email.endsWith('@larkfield.example')).toBe(true);
      expect(PRACTICE_CONSOLE_DEPARTMENTS).toContain(u.department);
      expect(PRACTICE_CONSOLE_ROLES).toContain(u.role);
    }
    for (const c of PRACTICE_CONSOLE_CAMPAIGNS) {
      expect(c.enrolled.every(e => ids.has(e.user))).toBe(true);
    }

    expect(q4.name).toBe('Q4 Security Awareness');
  });

  it('plants one duplicate user: the same name, a different email', () => {
    const twins = PRACTICE_CONSOLE_ROSTER.filter(r => !byEmail(r.email) && PRACTICE_CONSOLE_USERS.some(u => fullName(u) === `${r.first_name} ${r.last_name}`));

    expect(twins.map(r => r.email)).toEqual(['dana.whitfield@larkfield.example']);
    expect(PRACTICE_CONSOLE_USERS.find(u => fullName(u) === 'Dana Whitfield')).toMatchObject({ id: 'USR-1033', email: 'dwhitfield@larkfield.example' });
  });

  it('plants one roster person already enrolled in the campaign, with progress', () => {
    const already = PRACTICE_CONSOLE_ROSTER.map(r => byEmail(r.email)).filter(u => u && inQ4(u.id));

    expect(already.map(u => u!.id)).toEqual(['USR-1034']);
    expect(q4.enrolled.find(e => e.user === 'USR-1034')?.progress).toBe(60);
  });

  it('plants exactly three Active users who are not on the roster by email or by name', () => {
    const off = PRACTICE_CONSOLE_USERS.filter(u => u.status === 'Active' && !rosterEmails.has(u.email) && !PRACTICE_CONSOLE_ROSTER.some(r => `${r.first_name} ${r.last_name}` === fullName(u)));

    expect(off.map(u => u.email)).toEqual(['jordan.ames@larkfield.example', 'qa-test@larkfield.example', 'ellen.brooks@larkfield.example']);
  });

  it('hands over a roster of 20: 10 to add, 8 to enroll only, 2 to escalate', () => {
    const add = PRACTICE_CONSOLE_ROSTER.filter(r => !byEmail(r.email) && !PRACTICE_CONSOLE_USERS.some(u => fullName(u) === `${r.first_name} ${r.last_name}`));
    const enrollOnly = PRACTICE_CONSOLE_ROSTER.filter(r => byEmail(r.email) && !inQ4(byEmail(r.email)!.id));

    expect(PRACTICE_CONSOLE_ROSTER).toHaveLength(20);
    expect(new Set(PRACTICE_CONSOLE_ROSTER.map(r => r.email)).size).toBe(20);
    expect(add).toHaveLength(10);
    expect(enrollOnly).toHaveLength(8);
    expect(enrollOnly.every(r => byEmail(r.email)!.status === 'Active')).toBe(true);

    for (const r of PRACTICE_CONSOLE_ROSTER) {
      expect(PRACTICE_CONSOLE_DEPARTMENTS).toContain(r.department);
      expect(PRACTICE_CONSOLE_ROLES).toContain(r.role);
    }
  });

  it('plants the session expiry on the Add user form', () => {
    const body = practiceConsoleResponse(`${PRACTICE_CONSOLE_ORIGIN}/users/new`)!.body;

    expect(body).toContain('if (!S.get(\'expiredOnce\'))');
    expect(body).toContain('Your session expired. Sign in again to continue.');
  });

  it('gives a single-run example for a roster person who is new', () => {
    const { inputs } = PRACTICE_CONSOLE_TASK_EXAMPLE;

    expect(PRACTICE_CONSOLE_TASK_EXAMPLE.startUrl).toBe(`${PRACTICE_CONSOLE_ORIGIN}/login`);
    expect(inputs.password).toBe(PRACTICE_CONSOLE_SIGN_IN.password);
    expect(PRACTICE_CONSOLE_TASK_EXAMPLE.secretInputs).toEqual(['password']);
    expect(PRACTICE_CONSOLE_ROSTER.some(r => r.email === inputs.user_email)).toBe(true);
    expect(byEmail(inputs.user_email)).toBeUndefined();
  });

  it('carries no real-world data shapes', () => {
    const body = practiceConsoleResponse(`${PRACTICE_CONSOLE_ORIGIN}/`)!.body;
    for (const line of body.split('\n')) {
      for (const shape of REAL_DATA_SHAPES) {
        if (shape.pattern.test(line)) {
          expect(shape.allow.some(a => a.test(line)), `${shape.id}: ${line.slice(0, 120)}`).toBe(true);
        }
      }
    }
  });
});
