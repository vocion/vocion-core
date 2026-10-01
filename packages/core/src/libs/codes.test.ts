import { describe, expect, it } from 'vitest';
import { assignTypeCodes, CORE_NOUN_CODES, coreNounOf, deriveTypeCode, formatCode, nounCode, parseCode, recordCode, typeCodeOf } from './codes';

describe('deriveTypeCode', () => {
  it('reads initials of a multi-word slug, a short word whole, a long word\'s first three letters', () => {
    expect(deriveTypeCode('data_room')).toBe('DR');
    expect(deriveTypeCode('follow-up')).toBe('FU');
    expect(deriveTypeCode('deal')).toBe('DEAL');
    expect(deriveTypeCode('contact')).toBe('CON');
    expect(deriveTypeCode('x')).toBe('XX');
  });

  it('widens on request, never past five letters', () => {
    expect(deriveTypeCode('contact', 4)).toBe('CONT');
    expect(deriveTypeCode('data_room', 3)).toBe('DRO');
    expect(deriveTypeCode('proposal', 9)).toBe('PROPO');
  });
});

describe('typeCodeOf', () => {
  it('prefers the declared code, then the stored one, then the derived one', () => {
    expect(typeCodeOf({ slug: 'request', code: 'FE' })).toBe('FE');
    expect(typeCodeOf({ slug: 'request', schema: { 'x-code': 'FE' } })).toBe('FE');
    expect(typeCodeOf({ slug: 'request' })).toBe('REQ');
  });
});

describe('assignTypeCodes', () => {
  it('keeps declared codes and widens a derived code past a clash', () => {
    const { codes, problems } = assignTypeCodes([
      { slug: 'proposal' },
      { slug: 'product' },
      { slug: 'request', code: 'FE' },
    ]);

    expect(problems).toEqual([]);
    expect(codes.get('proposal')).toBe('PRO');
    expect(codes.get('product')).toBe('PROD');
    expect(codes.get('request')).toBe('FE');
  });

  it('refuses two types declaring one code, naming both', () => {
    const { problems } = assignTypeCodes([{ slug: 'request', code: 'FE' }, { slug: 'feature', code: 'FE' }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"request" and "feature" both declare code FE');
  });

  it('refuses a core noun\'s code and widens a derived one away from it', () => {
    const { codes, problems } = assignTypeCodes([{ slug: 'runbook', code: 'RUN' }, { slug: 'art' }]);

    expect(problems[0]).toContain('declares code RUN, which is core\'s');
    expect(codes.get('art')).not.toBe(CORE_NOUN_CODES.artifact);
  });

  it('gives a slug too short to widen a letter on the end, never no code', () => {
    const { codes, problems } = assignTypeCodes([{ slug: 'ask' }, { slug: 'run' }]);

    expect(problems).toEqual([]);
    expect(codes.get('ask')).toBe('ASKA');
    expect(codes.get('run')).toBe('RUNA');
  });
});

describe('parseCode', () => {
  it('reads codes case-insensitively, with or without the dash, and old bare references', () => {
    expect(parseCode('FE-294')).toEqual({ prefix: 'FE', id: 294 });
    expect(parseCode('fe-294')).toEqual({ prefix: 'FE', id: 294 });
    expect(parseCode(' run439 ')).toEqual({ prefix: 'RUN', id: 439 });
    expect(parseCode('#294')).toEqual({ prefix: null, id: 294 });
    expect(parseCode('294')).toEqual({ prefix: null, id: 294 });
    expect(parseCode(294)).toEqual({ prefix: null, id: 294 });
  });

  it('is null for anything that is not a code', () => {
    expect(parseCode('squatch-core#147')).toBeNull();
    expect(parseCode('the plan')).toBeNull();
    expect(parseCode('FE-0')).toBeNull();
    expect(parseCode('')).toBeNull();
    expect(parseCode(null)).toBeNull();
  });
});

describe('formatting', () => {
  it('writes a record\'s and a core noun\'s code', () => {
    expect(formatCode('fe', 294)).toBe('FE-294');
    expect(nounCode('run', 439)).toBe('RUN-439');
    expect(nounCode('action', 5590)).toBe('ACT-5590');
    expect(recordCode(new Map([['request', 'FE']]), 'request', 294)).toBe('FE-294');
    expect(recordCode(new Map(), 'deal', 7)).toBe('DEAL-7');
    expect(recordCode(null, null, 7)).toBe('#7');
  });

  it('knows which prefixes are core\'s', () => {
    expect(coreNounOf('chat')).toBe('conversation');
    expect(coreNounOf('FE')).toBeNull();
  });
});
