/**
 * Who operates the deployment: `VOCION_OPERATOR_EMAILS`, nothing else.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOperator } from './operator';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isOperator', () => {
  it('is nobody when the list is unset or empty', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', '');

    expect(isOperator('ops@company.example')).toBe(false);
    expect(isOperator('')).toBe(false);
  });

  it('matches a listed email, ignoring case and the spaces around list entries', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', ' ops@company.example , Lead@Company.example,,');

    expect(isOperator('ops@company.example')).toBe(true);
    expect(isOperator('OPS@company.example')).toBe(true);
    expect(isOperator(' lead@company.example ')).toBe(true);
  });

  it('reads a list separated by whitespace or newlines the same as one separated by commas', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@company.example\nlead@company.example other@company.example');

    expect(isOperator('ops@company.example')).toBe(true);
    expect(isOperator('lead@company.example')).toBe(true);
    expect(isOperator('other@company.example')).toBe(true);
  });

  it('is exact, so a look-alike address is not an operator', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@company.example');

    expect(isOperator('ops@company.example.attacker.example')).toBe(false);
    expect(isOperator('xops@company.example')).toBe(false);
    expect(isOperator('company.example')).toBe(false);
  });

  it('reads the list on every call, so a change applies without a restart', () => {
    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'ops@company.example');

    expect(isOperator('ops@company.example')).toBe(true);

    vi.stubEnv('VOCION_OPERATOR_EMAILS', 'other@company.example');

    expect(isOperator('ops@company.example')).toBe(false);
  });
});
