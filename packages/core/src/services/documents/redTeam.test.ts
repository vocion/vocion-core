import { describe, expect, it } from 'vitest';
import { parseFindings, prepareSheetsText, redTeamReceipt } from './redTeam';

// The pure half of the red team: what the reviewer reads, what comes back, what the agent is told.

const DOC = `<!doctype html><html><head><title>Northwind - Proposal (Metacto) v1.0</title></head><body>
<article class="sheet"><div class="strip"><span class="l">Proposal · Cover</span></div><div class="body"><h1>A record for every opening.</h1><p>Northwind hires 20 a month.</p></div><div class="foot"><div class="pnum">1 / 2</div></div></article>
<article class="sheet"><div class="strip"><span class="l">Proposal · Investment</span></div><div class="body"><h2>Investment</h2><p>$20,000 per month for 4 months.</p></div><div class="foot"><div class="pnum">2 / 2</div></div></article>
</body></html>`;

describe('prepareSheetsText', () => {
  it('gives the reviewer one labelled text block per sheet, tags stripped', () => {
    const sheets = prepareSheetsText(DOC);

    expect(sheets.map(s => s.n)).toEqual([1, 2]);
    expect(sheets[0]?.label).toBe('Proposal · Cover');
    expect(sheets[0]?.text).toContain('A record for every opening. Northwind hires 20 a month.');
    expect(sheets[1]?.text).toContain('$20,000 per month for 4 months.');
    expect(sheets[0]?.text).not.toContain('<');
  });
});

describe('parseFindings', () => {
  it('reads the JSON out of a chatty reply and validates it', () => {
    const parsed = parseFindings('Here you go:\n{"findings":[{"sheet":1,"severity":"block","rule":"outcome promised","finding":"Cover promises 30% fewer returns.","fix":"Replace with the measure to be baselined."}],"keeps":"The three-product order."}');

    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.findings[0]?.severity).toBe('block');
    expect(parsed?.keeps).toBe('The three-product order.');
  });

  it('is null on prose, and on a bad severity', () => {
    expect(parseFindings('I could not review this.')).toBeNull();
    expect(parseFindings('{"findings":[{"sheet":1,"severity":"meh","rule":"x","finding":"y","fix":"z"}]}')).toBeNull();
  });
});

describe('redTeamReceipt', () => {
  it('orders blocks first, numbers every finding with sheet, rule and fix, and says a block is not sent', () => {
    const out = redTeamReceipt({
      status: 'reviewed',
      model: 'test-model',
      sheets: 12,
      keeps: 'The measurement page.',
      findings: [
        { sheet: 9, severity: 'consider', rule: 'structure', finding: 'Two options read alike.', fix: 'Merge them.' },
        { sheet: 2, severity: 'block', rule: 'outcome promised', finding: 'Promises 30% fewer returns.', fix: 'Make it a measure to baseline.' },
        { sheet: 5, severity: 'fix', rule: 'scope', finding: 'Vision reads as included at all plants.', fix: 'Name the one plant.' },
      ],
    });

    expect(out).toContain('1 blocking · 1 to fix · 1 to consider');
    expect(out.split('\n')[1]).toMatch(/^1\. \[BLOCK\] sheet 2 · outcome promised: Promises 30% fewer returns\. → Make it a measure to baseline\./);
    expect(out).toContain('3. [CONSIDER] sheet 9');
    expect(out).toContain('Keep: The measurement page.');
    expect(out).toContain('A BLOCK is not sent');
  });

  it('says so when there is nothing to find, and when the pass was skipped', () => {
    expect(redTeamReceipt({ status: 'reviewed', model: 'm', sheets: 3, keeps: null, findings: [] })).toContain('no findings');
    expect(redTeamReceipt({ status: 'skipped', reason: 'no key' })).toBe('Red team skipped: no key.');
  });
});

describe('parseFindings — partial answers', () => {
  it('keeps the findings that validate when one entry is malformed', () => {
    const parsed = parseFindings(JSON.stringify({
      findings: [
        { sheet: 3, severity: 'block', rule: 'outcome promised', finding: 'Sheet 3 promises a 40% saving.', fix: 'Cut the figure; commit to measuring.' },
        { sheet: 4, severity: 'shouting', rule: 'x', finding: 'y', fix: 'z' },
      ],
      keeps: 'The plan sheet is clear.',
    }));

    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.findings[0]?.rule).toBe('outcome promised');
    expect(parsed?.keeps).toBe('The plan sheet is clear.');
  });

  it('gives up when nothing in the array validates', () => {
    expect(parseFindings(JSON.stringify({ findings: [{ sheet: 'one' }] }))).toBeNull();
  });
});
