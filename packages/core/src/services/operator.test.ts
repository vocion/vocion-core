/**
 * Who operates the deployment: `VOCION_OPERATOR_EMAILS`, nothing else — by
 * email, and by the email on a signed-in user's row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { userSchema } = await import('@/models/Schema');
const { isOperator, isOperatorUser } = await import('./operator');

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(userSchema);
});

describe('isOperator', () => {
  it('is nobody when the list is unset or empty', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', '');

    expect(isOperator('ops@northwind.example')).toBe(false);
    expect(isOperator('')).toBe(false);
    expect(isOperator(null)).toBe(false);
  });

  it('matches a listed email, ignoring case and the spaces around list entries', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', ' ops@northwind.example , Lead@Northwind.example,,');

    expect(isOperator('ops@northwind.example')).toBe(true);
    expect(isOperator('OPS@northwind.example')).toBe(true);
    expect(isOperator(' lead@northwind.example ')).toBe(true);
  });

  it('reads a list separated by whitespace or newlines the same as one separated by commas', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@northwind.example\nlead@northwind.example other@northwind.example');

    expect(isOperator('ops@northwind.example')).toBe(true);
    expect(isOperator('lead@northwind.example')).toBe(true);
    expect(isOperator('other@northwind.example')).toBe(true);
  });

  it('is exact, so a look-alike address is not an operator', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@northwind.example');

    expect(isOperator('ops@northwind.example.attacker.example')).toBe(false);
    expect(isOperator('xops@northwind.example')).toBe(false);
    expect(isOperator('northwind.example')).toBe(false);
  });

  it('reads the list on every call, so a change applies without a restart', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@northwind.example');

    expect(isOperator('ops@northwind.example')).toBe(true);

    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'other@northwind.example');

    expect(isOperator('ops@northwind.example')).toBe(false);
  });
});

describe('isOperatorUser', () => {
  it('reads the person\'s email off their user row', async () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@northwind.example');
    await db.insert(userSchema).values([
      { id: 'usr-ops', email: 'OPS@northwind.example' },
      { id: 'usr-sam', email: 'sam@northwind.example' },
    ]);

    expect(await isOperatorUser('usr-ops')).toBe(true);
    expect(await isOperatorUser('usr-sam')).toBe(false);
    expect(await isOperatorUser('usr-nobody')).toBe(false);
    expect(await isOperatorUser(null)).toBe(false);
  });

  it('is nobody when the list is unset, whoever the user is', async () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', '');
    await db.insert(userSchema).values({ id: 'usr-ops', email: 'ops@northwind.example' });

    expect(await isOperatorUser('usr-ops')).toBe(false);
  });
});
