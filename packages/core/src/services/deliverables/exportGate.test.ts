import type { DocumentRedTeam } from '@/libs/cards/specs';
import { describe, expect, it } from 'vitest';
import { prepareSlidesText, redTeamReceipt } from '@/services/documents/redTeam';
import { DEFAULT_CLIENT_FACING_PLAYBOOKS, exportGate, isClientFacing, SLIDE_UNIT } from './exportGate';

const blocked: DocumentRedTeam = {
  at: '2026-10-20T10:00:00.000Z',
  version: 4,
  model: 'test-model',
  sheets: 9,
  blocks: 2,
  fixes: 0,
  considers: 0,
  findings: [
    { sheet: 3, severity: 'block', rule: 'unsourced figure', finding: 'Slide 3 claims a 40% saving with no source.', fix: 'Mark it [$__] or cite the call.' },
    { sheet: 7, severity: 'block', rule: 'outcome promised', finding: 'Slide 7 promises go-live by March.', fix: 'Commit to the plan, not the date.' },
  ],
};

describe('the shared export gate', () => {
  it('gates concepts and case studies by default, beside the document playbooks', () => {
    expect(DEFAULT_CLIENT_FACING_PLAYBOOKS).toEqual(expect.arrayContaining(['proposal', 'scope', 'partnership-update', 'concept', 'case-study']));
    expect(isClientFacing('Case study')).toBe(true);
    expect(isClientFacing('concept')).toBe(true);
  });

  it('holds an agent\'s deck export on a block, naming slides and edit_deck', () => {
    const gate = exportGate({ playbook: 'concept', read: { kind: 'read', redTeam: blocked }, unit: SLIDE_UNIT });

    expect(gate.action).toBe('refuse');
    expect(gate.action === 'refuse' && gate.line).toContain('This deck is not sent until they are answered.');
    expect(gate.action === 'refuse' && gate.line).toContain('1. slide 3 · unsourced figure');
    expect(gate.action === 'refuse' && gate.line).toContain('Fix each one with edit_deck on the named slide');
  });

  it('gives a person who asked the PDF, with the block as one line of advice', () => {
    const gate = exportGate({ playbook: 'concept', read: { kind: 'read', redTeam: blocked }, unit: SLIDE_UNIT, onPersonsWord: true });

    expect(gate.action).toBe('export');
    expect(gate.action === 'export' && gate.line).toBe('Exported as asked. Before it is sent: a sceptical buyer would stop on slide 3 — Slide 3 claims a 40% saving with no source. (and 1 more blocking).');
    expect(gate.action === 'export' && gate.line?.includes('\n')).toBe(false);
  });

  it('documents keep their wording', () => {
    const gate = exportGate({ playbook: 'proposal', read: { kind: 'read', redTeam: blocked } });

    expect(gate.action === 'refuse' && gate.line).toContain('This document is not sent until they are answered.');
    expect(gate.action === 'refuse' && gate.line).toContain('1. sheet 3 · unsourced figure');
  });
});

describe('the red team on a deck', () => {
  it('reads every slide\'s text and its speaker notes, numbered', () => {
    const units = prepareSlidesText({
      order: ['a', 'b'],
      slides: {
        a: '<section id="a"><h1>Northwind saves 40%</h1><aside>Draft figure from the 2026-09-12 call; to be baselined.</aside></section>',
        b: '<section id="b"><h2>Next step</h2></section>',
      },
    });

    expect(units).toEqual([
      { n: 1, label: 'Northwind saves 40%', text: 'Northwind saves 40%\n[speaker notes] Draft figure from the 2026-09-12 call; to be baselined.' },
      { n: 2, label: 'Next step', text: 'Next step\n[no speaker notes]' },
    ]);
  });

  it('writes its receipt in slides and points at edit_deck', () => {
    const text = redTeamReceipt({ status: 'reviewed', findings: blocked.findings, keeps: null, model: 'test-model', sheets: 9 }, SLIDE_UNIT);

    expect(text).toContain('Red team (test-model, 9 slides)');
    expect(text).toContain('[BLOCK] slide 3');
    expect(text).toContain('Fix each with edit_deck by slide');
  });
});
