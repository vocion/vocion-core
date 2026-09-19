import type { RedTeamFinding } from './redTeam';
import type { DocumentRedTeam } from '@/libs/cards/specs';
import { describe, expect, it } from 'vitest';
import { redTeamChip } from '@/libs/documents/audit';
import { exportGate, isClientFacing } from './exportGate';
import { parseFindings, prepareSheetsText, redTeamReceipt, redTeamRecord } from './redTeam';

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

// The gate on the way out: which documents are read as the buyer before they
// can leave as a PDF, and what the export does in each state. Pure — no
// database, no model, no browser.

const BLOCK: RedTeamFinding = { sheet: 2, severity: 'block', rule: 'outcome promised', finding: 'Sheet 2 promises a 30% saving.', fix: 'Cut the figure; commit to measuring together.' };
const FIX: RedTeamFinding = { sheet: 5, severity: 'fix', rule: 'scope', finding: 'Vision reads as included at all plants.', fix: 'Name the one plant.' };
const CONSIDER: RedTeamFinding = { sheet: 9, severity: 'consider', rule: 'structure', finding: 'Two options read alike.', fix: 'Merge them.' };

function reviewed(findings: RedTeamFinding[]) {
  return { status: 'reviewed' as const, model: 'test-model', sheets: 12, keeps: null, findings };
}

describe('redTeamRecord', () => {
  it('counts by severity and stores the findings blocks first', () => {
    const record = redTeamRecord(reviewed([CONSIDER, FIX, BLOCK]), 4);

    expect(record.version).toBe(4);
    expect(record.model).toBe('test-model');
    expect(record.sheets).toBe(12);
    expect({ blocks: record.blocks, fixes: record.fixes, considers: record.considers }).toEqual({ blocks: 1, fixes: 1, considers: 1 });
    expect(record.findings.map(f => f.severity)).toEqual(['block', 'fix', 'consider']);
  });

  it('caps the stored findings without ever dropping a block', () => {
    const many = [
      ...Array.from({ length: 25 }, (_, i) => ({ ...CONSIDER, sheet: i + 1 })),
      { ...BLOCK, sheet: 30 },
    ];

    const record = redTeamRecord(reviewed(many), 1);

    expect(record.findings).toHaveLength(20);
    expect(record.findings[0]).toMatchObject({ severity: 'block', sheet: 30 });
    expect(record.blocks).toBe(1);
    expect(record.considers).toBe(25);
  });
});

describe('isClientFacing', () => {
  it('gates the document playbooks that ship today and nothing else', () => {
    expect(isClientFacing('proposal')).toBe(true);
    expect(isClientFacing('scope')).toBe(true);
    expect(isClientFacing('partnership-update')).toBe(true);
    expect(isClientFacing('email-copy')).toBe(false);
    expect(isClientFacing('work-sample')).toBe(false);
  });

  it('never gates a document with no playbook tag', () => {
    expect(isClientFacing(undefined)).toBe(false);
    expect(isClientFacing(null)).toBe(false);
    expect(isClientFacing('  ')).toBe(false);
  });

  it('reads the tag the way an agent types it', () => {
    expect(isClientFacing('Proposal')).toBe(true);
    expect(isClientFacing(' partnership_update ')).toBe(true);
  });

  it('takes the workspace list over the defaults, and an empty one gates nothing', () => {
    expect(isClientFacing('proposal', ['statement-of-work'])).toBe(false);
    expect(isClientFacing('statement-of-work', ['statement-of-work'])).toBe(true);
    expect(isClientFacing('proposal', [])).toBe(false);
    expect(isClientFacing('proposal', null)).toBe(true);
  });
});

describe('exportGate', () => {
  const record = (over: Partial<DocumentRedTeam> = {}): DocumentRedTeam => ({
    at: '2026-09-19T10:00:00.000Z',
    version: 3,
    model: 'test-model',
    sheets: 12,
    blocks: 0,
    fixes: 0,
    considers: 0,
    findings: [],
    ...over,
  });

  it('lets an untagged document straight out, read or not', () => {
    expect(exportGate({ playbook: undefined, read: { kind: 'none' } })).toEqual({ action: 'export', line: null });
  });

  it('reads a gated document first when this version has never been read', () => {
    expect(exportGate({ playbook: 'proposal', read: { kind: 'none' } })).toEqual({ action: 'read-first' });
  });

  it('exports a gated document that already came back clean, and cites the read', () => {
    const gate = exportGate({ playbook: 'proposal', read: { kind: 'read', redTeam: record({ fixes: 2, considers: 1 }) } });

    expect(gate.action).toBe('export');
    expect(gate.action === 'export' && gate.line).toContain('Read as the buyer at v3 on 2026-09-19');
    expect(gate.action === 'export' && gate.line).toContain('no blocking findings (2 to fix · 1 to consider)');
  });

  it('says it did the read itself when the export ran it', () => {
    const gate = exportGate({ playbook: 'proposal', read: { kind: 'read', redTeam: record(), fresh: true } });

    expect(gate.action === 'export' && gate.line).toContain('Read as the buyer first (test-model, 12 sheets): no findings.');
  });

  it('refuses on a block, naming the sheet and the fix, and says it is not sent', () => {
    const gate = exportGate({ playbook: 'proposal', read: { kind: 'read', redTeam: record({ blocks: 1, findings: [BLOCK, CONSIDER] }) } });

    expect(gate.action).toBe('refuse');
    expect(gate.action === 'refuse' && gate.line).toContain('NOT exported');
    expect(gate.action === 'refuse' && gate.line).toContain('not sent until they are answered');
    expect(gate.action === 'refuse' && gate.line).toContain('1. sheet 2 · outcome promised: Sheet 2 promises a 30% saving. → Cut the figure');
    expect(gate.action === 'refuse' && gate.line).not.toContain('Two options read alike');
  });

  it('never silently blocks when the read could not run — it exports and says why', () => {
    const gate = exportGate({ playbook: 'proposal', read: { kind: 'unavailable', reason: 'no Anthropic key is configured for this workspace or the server' } });

    expect(gate.action).toBe('export');
    expect(gate.action === 'export' && gate.line).toContain('NOT read as the buyer first: no Anthropic key');
  });

  it('honours a workspace that gates nothing', () => {
    expect(exportGate({ playbook: 'proposal', configured: [], read: { kind: 'none' } })).toEqual({ action: 'export', line: null });
  });
});

describe('redTeamChip', () => {
  it('says whether this version was read, and what it cost', () => {
    expect(redTeamChip(undefined)).toBe('not read as the buyer');
    expect(redTeamChip(redTeamRecord(reviewed([]), 1))).toBe('read as the buyer · clean');
    expect(redTeamChip(redTeamRecord(reviewed([FIX]), 1))).toBe('read as the buyer · 1 to fix');
    expect(redTeamChip(redTeamRecord(reviewed([BLOCK, BLOCK]), 1))).toBe('read as the buyer · 2 blocking');
  });
});
