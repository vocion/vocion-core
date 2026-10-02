import { describe, expect, it } from 'vitest';
import { expandRecurrence, readRule, ruleEndedBefore } from './recurrence';
import { instantInZone, isoInZone } from './zone';

const NY = 'America/New_York';
const ny = (local: string) => instantInZone(local, NY);
const window = { from: ny('2026-09-29T00:00:00'), to: ny('2026-11-28T00:00:00') };

describe('expandRecurrence', () => {
  it('keeps a UTC-anchored weekly rule on its UTC weekday, which is the local day before', () => {
    // 20:00 EDT on a Thursday is 00:00 UTC on Friday; BYDAY=FR in UTC is that same Thursday evening in New York.
    const out = expandRecurrence({ start: new Date('2026-05-29T00:00:00Z'), anchorZone: 'UTC', rule: 'FREQ=WEEKLY;BYDAY=FR', exdates: [], rdates: [], ...window });

    expect(out.slice(0, 2).map(d => d.toISOString())).toEqual(['2026-10-02T00:00:00.000Z', '2026-10-09T00:00:00.000Z']);
    expect(isoInZone(out[0]!, NY).slice(0, 10)).toBe('2026-10-01');
  });

  it('keeps a zoned weekly rule on its wall-clock time across the clock change', () => {
    const out = expandRecurrence({ start: ny('2026-05-28T15:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;BYDAY=TH', exdates: [], rdates: [], ...window });
    const locals = out.map(d => isoInZone(d, NY));

    expect(locals[0]).toBe('2026-10-01T15:00:00-04:00');
    expect(locals).toContain('2026-11-05T15:00:00-05:00');
    expect(locals).toHaveLength(9);
  });

  it('counts COUNT from the first occurrence, not from today', () => {
    const out = expandRecurrence({ start: ny('2026-05-28T15:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;COUNT=10', exdates: [], rdates: [], ...window });

    expect(out).toEqual([]);
  });

  it('counts occurrences in calendar order when BYDAY is written out of order', () => {
    const out = expandRecurrence({ start: ny('2026-10-01T15:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;BYDAY=TH,MO;COUNT=2', exdates: [], rdates: [], ...window });

    expect(out.map(d => isoInZone(d, NY).slice(0, 10))).toEqual(['2026-10-01', '2026-10-05']);
  });

  it('stops at UNTIL, skips EXDATE and adds RDATE', () => {
    const out = expandRecurrence({
      start: ny('2026-09-01T18:00:00'),
      anchorZone: NY,
      rule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261020T225959Z',
      exdates: [ny('2026-10-06T18:00:00')],
      rdates: [ny('2026-11-15T12:00:00')],
      ...window,
    });

    expect(out.map(d => isoInZone(d, NY).slice(0, 16))).toEqual(['2026-09-29T18:00', '2026-10-13T18:00', '2026-10-20T18:00', '2026-11-15T12:00']);
  });

  it('expands every second day with INTERVAL', () => {
    const out = expandRecurrence({ start: ny('2026-09-28T09:00:00'), anchorZone: NY, rule: 'FREQ=DAILY;INTERVAL=2', exdates: [], rdates: [], from: ny('2026-09-29T00:00:00'), to: ny('2026-10-05T00:00:00') });

    expect(out.map(d => isoInZone(d, NY).slice(0, 10))).toEqual(['2026-09-30', '2026-10-02', '2026-10-04']);
  });

  it('reaches the window of a series that has run for twenty years', () => {
    const out = expandRecurrence({ start: ny('2006-01-05T15:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;BYDAY=TH', exdates: [], rdates: [], ...window });

    expect(out).toHaveLength(9);
    expect(isoInZone(out[0]!, NY).slice(0, 10)).toBe('2026-10-01');
  });

  it('leaves rules it does not read to the model', () => {
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=MONTHLY;BYDAY=WE', exdates: [], rdates: [], ...window })).toEqual([]);
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;BYDAY=1TH', exdates: [], rdates: [], ...window })).toEqual([]);
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=DAILY;COUNT=5000', exdates: [], rdates: [], ...window })).toEqual([]);
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;BYDAY=TU;BYMONTH=6,7,8', exdates: [], rdates: [], ...window })).toEqual([]);
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', exdates: [], rdates: [], ...window })).toEqual([]);
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;UNTIL=20261340', exdates: [], rdates: [], ...window })).toEqual([]);
    expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule: 'FREQ=WEEKLY;BYDAY=TU,SU;WKST=XX', exdates: [], rdates: [], ...window })).toEqual([]);
  });

  it('returns nothing for an UNTIL it cannot read, rather than running past it', () => {
    for (const rule of ['FREQ=WEEKLY;UNTIL=20261231T235959', 'FREQ=WEEKLY;UNTIL=2026-12-31', 'FREQ=WEEKLY;UNTIL=soon', 'FREQ=DAILY;UNTIL=']) {
      expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule, exdates: [], rdates: [], ...window })).toEqual([]);
    }
  });

  it('reads INTERVAL and COUNT only as whole numbers, and an UNTIL only as a real date', () => {
    for (const rule of ['FREQ=WEEKLY;INTERVAL=abc', 'FREQ=WEEKLY;INTERVAL=1.5', 'FREQ=WEEKLY;INTERVAL=0', 'FREQ=WEEKLY;COUNT=1.5', 'FREQ=WEEKLY;UNTIL=20261231T250000Z', 'FREQ=WEEKLY;UNTIL=20261131']) {
      expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule, exdates: [], rdates: [], ...window })).toEqual([]);
    }
  });

  it('returns nothing, and never throws, for a runaway interval or a start outside four-digit years', () => {
    const expand = (rule: string, start = ny('2026-09-01T18:00:00'), anchorZone = NY) => () => expandRecurrence({ start, anchorZone, rule, exdates: [], rdates: [], ...window });

    for (const rule of ['FREQ=WEEKLY;INTERVAL=500000', 'FREQ=WEEKLY;INTERVAL=1001', 'FREQ=DAILY;INTERVAL=3000000']) {
      expect(expand(rule)).not.toThrow();
      expect(expand(rule)()).toEqual([]);
    }

    expect(expand('FREQ=WEEKLY;INTERVAL=1001', ny('2026-10-06T18:00:00'))()).toEqual([]);
    expect(expand('FREQ=WEEKLY;INTERVAL=1000')).not.toThrow();
    expect(expand('FREQ=WEEKLY;INTERVAL=1000', ny('2026-10-06T18:00:00'))()).toHaveLength(1);

    for (const rule of ['FREQ=WEEKLY', 'FREQ=DAILY']) {
      expect(expand(rule, new Date('0999-01-05T15:00:00Z'), 'UTC')).not.toThrow();
      expect(expand(rule, new Date('0999-01-05T15:00:00Z'), 'UTC')()).toEqual([]);
    }
  });

  describe('monthly, on a weekday by its place in the month', () => {
    const monthly = (rule: string, start = ny('2026-09-01T18:00:00'), to = window.to) => expandRecurrence({ start, anchorZone: NY, rule, exdates: [], rdates: [], from: window.from, to }).map(d => isoInZone(d, NY).slice(0, 16));

    it('reads the first and the last weekday of each month, on the rule\'s own clock', () => {
      expect(monthly('FREQ=MONTHLY;BYDAY=1TU')).toEqual(['2026-10-06T18:00', '2026-11-03T18:00']);
      expect(monthly('FREQ=MONTHLY;BYDAY=-1TU')).toEqual(['2026-09-29T18:00', '2026-10-27T18:00', '2026-11-24T18:00']);
      expect(monthly('FREQ=MONTHLY;BYDAY=+1TU,3TU')).toEqual(['2026-10-06T18:00', '2026-10-20T18:00', '2026-11-03T18:00', '2026-11-17T18:00']);
    });

    it('skips a month that has no such weekday', () => {
      expect(monthly('FREQ=MONTHLY;BYDAY=5TU', ny('2026-09-01T18:00:00'), ny('2027-01-01T00:00:00'))).toEqual(['2026-09-29T18:00', '2026-12-29T18:00']);
    });

    it('steps INTERVAL months from the first occurrence', () => {
      expect(monthly('FREQ=MONTHLY;INTERVAL=2;BYDAY=1TU')).toEqual(['2026-11-03T18:00']);
    });

    it('counts COUNT from the first occurrence, never from a date before it', () => {
      expect(monthly('FREQ=MONTHLY;BYDAY=1TU;COUNT=2')).toEqual(['2026-10-06T18:00']);
      expect(monthly('FREQ=MONTHLY;BYDAY=1TU;COUNT=1')).toEqual([]);
      expect(monthly('FREQ=MONTHLY;BYDAY=1TU;COUNT=2', ny('2026-09-15T18:00:00'))).toEqual(['2026-10-06T18:00', '2026-11-03T18:00']);
    });

    it('stops at UNTIL', () => {
      expect(monthly('FREQ=MONTHLY;BYDAY=-1TU;UNTIL=20261101T000000Z')).toEqual(['2026-09-29T18:00', '2026-10-27T18:00']);
    });

    it('reaches the window of a series that has run for twenty years', () => {
      expect(monthly('FREQ=MONTHLY;BYDAY=1TU', ny('2006-01-03T18:00:00'))).toEqual(['2026-10-06T18:00', '2026-11-03T18:00']);
    });
  });

  it('stops walking at the last day a four-digit year can name', () => {
    const far = () => expandRecurrence({ start: new Date('9999-12-01T15:00:00Z'), anchorZone: 'UTC', rule: 'FREQ=WEEKLY;INTERVAL=1000', exdates: [], rdates: [], from: new Date('9999-12-15T00:00:00Z'), to: new Date('+020000-01-01T00:00:00Z') });

    expect(far).not.toThrow();
    expect(far()).toEqual([]);
  });
});

describe('readRule', () => {
  it('reads the rules the expander walks', () => {
    for (const rule of ['FREQ=WEEKLY', 'FREQ=DAILY;INTERVAL=2;COUNT=5', 'FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T235959Z;WKST=SU', 'freq=weekly;until=20261231']) {
      expect(readRule(rule)).toBeDefined();
    }

    expect(readRule('FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T235959Z;WKST=SU')).toEqual({ freq: 'WEEKLY', interval: 1, until: '20261231T235959Z', byDay: ['MO', 'TH'], wkst: 6 });
    expect(readRule('FREQ=MONTHLY;BYDAY=3WE,-1FR')).toEqual({ freq: 'MONTHLY', interval: 1, byDay: ['3WE', '-1FR'], wkst: 0 });
  });

  it('refuses exactly what the expander leaves to the model', () => {
    for (const rule of ['FREQ=MONTHLY', 'FREQ=MONTHLY;BYDAY=WE', 'FREQ=MONTHLY;BYDAY=1WE,FR', 'FREQ=MONTHLY;BYDAY=6WE', 'FREQ=MONTHLY;BYDAY=0WE', 'FREQ=MONTHLY;BYMONTHDAY=15', 'FREQ=YEARLY', 'FREQ=WEEKLY;BYDAY=1TH', 'FREQ=DAILY;COUNT=5000', 'FREQ=WEEKLY;BYDAY=TU;BYMONTH=6,7,8', 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY;UNTIL=20261340', 'FREQ=WEEKLY;BYDAY=TU,SU;WKST=XX', 'FREQ=WEEKLY;INTERVAL=abc', 'FREQ=WEEKLY;INTERVAL=0', 'FREQ=WEEKLY;INTERVAL=1001', 'FREQ=WEEKLY;COUNT=1.5', 'FREQ=WEEKLY;UNTIL=20261231T250000Z', 'FREQ=WEEKLY;UNTIL=20261131']) {
      expect(readRule(rule)).toBeUndefined();
      expect(expandRecurrence({ start: ny('2026-09-01T18:00:00'), anchorZone: NY, rule, exdates: [], rdates: [], ...window })).toEqual([]);
    }
  });
});

describe('ruleEndedBefore', () => {
  it('reads an UNTIL by its day, whatever form the rest of it takes', () => {
    expect(ruleEndedBefore('FREQ=MONTHLY;BYDAY=1FR;UNTIL=20260929T170000Z', '2026-09-30')).toBe(true);
    expect(ruleEndedBefore('FREQ=MONTHLY;BYDAY=1FR;UNTIL=20260930T235959', '2026-09-30')).toBe(false);
    expect(ruleEndedBefore('FREQ=YEARLY;UNTIL=20271231', '2026-09-30')).toBe(false);
  });

  it('runs a COUNT out at its longest period from the start', () => {
    expect(ruleEndedBefore('FREQ=MONTHLY;BYDAY=1FR;COUNT=3', '2026-09-30', '20250801T190000')).toBe(true);
    expect(ruleEndedBefore('FREQ=MONTHLY;BYDAY=1FR;COUNT=3', '2026-09-30', '20260801T190000')).toBe(false);
    expect(ruleEndedBefore('FREQ=YEARLY;INTERVAL=2;COUNT=2', '2026-09-30', '20240801')).toBe(false);
    expect(ruleEndedBefore('FREQ=YEARLY;INTERVAL=2;COUNT=2', '2029-09-30', '20240801')).toBe(true);
  });

  it('reads as still running whatever it cannot tell', () => {
    for (const [rule, start] of [['FREQ=MONTHLY;BYDAY=1FR', '20200101'], ['FREQ=MONTHLY;UNTIL=soon', '20200101'], ['FREQ=MONTHLY;COUNT=3', ''], ['FREQ=MONTHLY;COUNT=many', '20200101'], ['FREQ=MONTHLY;COUNT=3;INTERVAL=x', '20200101']] as const) {
      expect(ruleEndedBefore(rule, '2026-09-30', start)).toBe(false);
    }
  });
});
