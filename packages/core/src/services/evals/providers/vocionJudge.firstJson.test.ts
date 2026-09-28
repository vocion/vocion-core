import { describe, expect, it } from 'vitest';
import { firstJsonObject } from './vocionJudge';

describe('firstJsonObject', () => {
  it('takes the verdict even when the judge keeps talking after it', () => {
    expect(firstJsonObject('{"verdict":"pass","score":0.9,"rationale":"fine: {see} \\"quoted\\""} Hope that helps.')).toBe('{"verdict":"pass","score":0.9,"rationale":"fine: {see} \\"quoted\\""}');
    expect(firstJsonObject('Sure! {"verdict":"fail","score":0}')).toBe('{"verdict":"fail","score":0}');
    expect(firstJsonObject('no json here')).toBeNull();
    expect(firstJsonObject('{"unterminated": true')).toBeNull();
  });
});
