/**
 * The person asked, on a record's page, for that record to change, and the
 * turn wrote nothing: one pass with update_object chosen writes the change
 * (journey 4, 2026-09-28, request #214). The tool is the real update_object
 * behind the real schema; the model and the action rail are written down.
 */
import type { RuntimeContext } from './types';
import { AIMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import { answerNamesFiled, asksToChange, changedInTurn, changeLine, changeOwedRecord } from './owedWriteBackstop';

const proposed: Array<Record<string, unknown>> = [];
let nextStatus: 'done' | 'pending' = 'done';
vi.mock('@/services/ActionService', () => ({
  ActionError: class ActionError extends Error {
    code = 'refused';
  },
  proposeAction: async (req: Record<string, unknown>) => {
    proposed.push(req);
    return { runId: 5001, status: nextStatus, outcome: 'created', result: { title: 'Download CSV of document viewers' } };
  },
}));

const { updateObjectTool } = await import('./tools/updateObject');

const ctx = { orgId: 'org_owed_change', agentSlug: 'product-manager', objectTypeSlugs: ['request'], emit: () => {}, citationSeq: { current: 0 }, delegations: new Map() } as unknown as RuntimeContext;

const RECORD = {
  id: 214,
  typeSlug: 'request',
  label: 'request #214',
  href: '/w/northwind/dashboard/p/feature/214',
  fields: {
    title: 'Download CSV of document viewers',
    acceptance: [{ statement: 'A Download CSV button appears beside "Who opened it".' }, { statement: 'One row per named viewer: email, first open, last open, time spent.' }],
  },
};

function modelMaking(calls: Array<Record<string, unknown>>) {
  const seen: unknown[][] = [];
  const bound: Array<{ opts: unknown }> = [];
  return {
    seen,
    bound,
    bindTools: (_tools: unknown[], opts?: unknown) => {
      bound.push({ opts });
      return {
        invoke: async (messages: unknown[]) => {
          seen.push([...messages]);
          const args = calls[seen.length - 1];
          return new AIMessage({ content: '', tool_calls: args ? [{ id: `c${seen.length}`, name: 'update_object', args }] : [] });
        },
      };
    },
  };
}

describe('which messages ask for the record on the page to change', () => {
  it('reads journey 4\'s ask, and the usual shapes, as a change', () => {
    expect(asksToChange('Change this request: also include which pages each viewer read, and the CSV filename should be the document title plus today\'s date.')).toBe(true);
    expect(asksToChange('Please add a criterion that the export works on a phone.')).toBe(true);
    expect(asksToChange('Remove the second acceptance line.')).toBe(true);
    expect(asksToChange('Can you update the story to say founders, not owners?')).toBe(true);
    expect(asksToChange('Mark it as deferred until the paid plan ships.')).toBe(true);
  });

  it('does not read a question, a refusal, a status ask or a new filing as a change', () => {
    expect(asksToChange('How do I change the acceptance criteria?')).toBe(false);
    expect(asksToChange('Don\'t change anything yet.')).toBe(false);
    expect(asksToChange('Where is this now?')).toBe(false);
    expect(asksToChange('Update me on where this stands.')).toBe(false);
    expect(asksToChange('What would change if we built it?')).toBe(false);
    expect(asksToChange('File a feature request for Send: a Download CSV button.')).toBe(false);
  });
});

describe('what counts as the record changed in the turn', () => {
  it('a write to that record, landed or queued — never a refusal, never another record', () => {
    expect(changedInTurn([{ tool: 'update_object', input: { id: 214 }, output: 'request #214 updated — acceptance written (run #9).' }], 214)).toBe(true);
    expect(changedInTurn([{ tool: 'update_object', input: { id: 214 }, output: 'Update to request #214 (acceptance) is PENDING a person\'s decision (run #9)' }], 214)).toBe(true);
    expect(changedInTurn([{ tool: 'update_object', input: { id: 214 }, output: 'Update refused (invalid): acceptance must be an array' }], 214)).toBe(false);
    expect(changedInTurn([{ tool: 'update_object', input: { id: 13 }, output: 'request #13 updated — priority written (run #9).' }], 214)).toBe(false);
    expect(changedInTurn([{ tool: 'read_object', input: { id: 214 }, output: '{}' }], 214)).toBe(false);
  });
});

describe('the line the person reads', () => {
  it('says what changed, with the link — or that it waits in Review', () => {
    expect(changeLine('request #214 "Download CSV" updated — acceptance written (run #9, confidence 0.9). Done for you;', 'request #214', '/w/northwind/dashboard/p/feature/214', 'Added a pages-read column and a title-plus-date filename.'))
      .toBe('Changed [request #214](/w/northwind/dashboard/p/feature/214): Added a pages-read column and a title-plus-date filename.');
    expect(changeLine('Update to request #214 (acceptance) is PENDING a person\'s decision (run #9, confidence 0.5 was under the bar', 'request #214', null, 'Added a column'))
      .toBe('The change to request #214 is waiting in Review as action run #9: Added a column. Nothing is changed until a person approves it.');
    expect(changeLine('Update refused (invalid): …', 'request #214', null, 'x')).toBeNull();
  });
});

describe('the change pass', () => {
  it('writes the change to the PAGE\'s record with update_object chosen, whatever id the model sent', async () => {
    proposed.length = 0;
    nextStatus = 'done';
    const acceptance = [...RECORD.fields.acceptance, { statement: 'Each row lists the pages that viewer read.' }, { statement: 'The file is named <document title> <today\'s date>.csv.' }];
    const model = modelMaking([{ object_type: 'request', id: 13, set: { acceptance }, reason: 'Added a pages-read column and a title-plus-date filename.', confidence: 0.9 }]);
    const res = await changeOwedRecord({
      request: 'Change this request: also include which pages each viewer read, and the CSV filename should be the document title plus today\'s date.',
      history: [],
      answer: 'Updated request #214 — two changes to the commitment.',
      record: RECORD,
      tool: updateObjectTool(ctx),
      model: model as never,
    });

    expect(model.bound[0]?.opts).toEqual({ tool_choice: 'update_object' });
    // The record as it stands is in front of the model, so a list is written whole.
    expect(String((model.seen[0]![1] as { content: unknown }).content)).toContain('One row per named viewer');
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ actionId: 'objects.update_meta', input: { objectType: 'request', id: 214, set: { acceptance } } });
    expect(res).toMatchObject({ filed: true, line: 'Changed [request #214](/w/northwind/dashboard/p/feature/214): Added a pages-read column and a title-plus-date filename.' });
    expect(res.args).toMatchObject({ id: 214, object_type: 'request' });
  });

  it('below the trust bar the change waits in Review and the line says so', async () => {
    proposed.length = 0;
    nextStatus = 'pending';
    const model = modelMaking([{ object_type: 'request', id: 214, set: { story: 'As a founder…' }, reason: 'Reworded the story.', confidence: 0.4 }]);
    const res = await changeOwedRecord({ request: 'Update the story to say founders.', history: [], answer: '', record: RECORD, tool: updateObjectTool(ctx), model: model as never });

    expect(res.filed).toBe(true);
    expect(res.line).toMatch(/^The change to \[request #214\]\(.+\) is waiting in Review as action run #5001: Reworded the story\./);
  });

  it('a model that makes no call changes nothing and says why', async () => {
    const res = await changeOwedRecord({ request: 'Change it.', history: [], answer: '', record: RECORD, tool: updateObjectTool(ctx), model: modelMaking([]) as never });

    expect(res).toMatchObject({ filed: false, output: 'the model returned no call' });
  });
});

describe('a filing the answer already names is announced once (journey 4: "Filed from this conversation" over "Filed as")', () => {
  const OUTPUT = 'objects.propose_candidate is DONE: filed as request #214 (run #4944, confidence 0.95), open at /w/northwind/dashboard/p/feature/214. Title: Download CSV.';

  it('by number or by link', () => {
    expect(answerNamesFiled('Filed as [request #214](/w/northwind/dashboard/p/feature/214).', OUTPUT)).toBe(true);
    expect(answerNamesFiled('Filed as request #214.', OUTPUT)).toBe(true);
    expect(answerNamesFiled('I checked the capabilities page.', OUTPUT)).toBe(false);
    expect(answerNamesFiled('See request #2140.', OUTPUT)).toBe(false);
  });
});
