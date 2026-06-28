import { describe, expect, it } from 'vitest';
import { calculate } from './calculator';

describe('calculate', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(calculate('1234 * 0.0825')).toBeCloseTo(101.805, 5);
    expect(calculate('(2 + 3) * 4')).toBe(20);
    expect(calculate('2 ^ 10')).toBe(1024);
  });

  it('supports allowlisted functions and constants', () => {
    expect(calculate('round(sqrt(2) * 100) / 100')).toBe(1.41);
    expect(calculate('max(3, 7, 2)')).toBe(7);
    expect(calculate('pi')).toBeCloseTo(Math.PI, 10);
  });

  it('rejects non-allowlisted identifiers (no global access)', () => {
    expect(() => calculate('constructor')).toThrow(/unknown identifier/);
    expect(() => calculate('process.exit(1)')).toThrow();
    expect(() => calculate('globalThis')).toThrow(/unknown identifier/);
    expect(() => calculate('e.constructor')).toThrow(/unknown identifier/);
  });

  it('rejects unsupported characters and non-finite results', () => {
    expect(() => calculate('"hi"')).toThrow(/unsupported characters/);
    expect(() => calculate('1/0')).toThrow(/finite/);
    expect(() => calculate('')).toThrow(/empty/);
  });
});
