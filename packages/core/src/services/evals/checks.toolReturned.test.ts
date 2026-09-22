/**
 * `toolReturned` — rules about what a tool handed back, and `*` paths.
 *
 * Arguments say what the agent asked for; only the return says whether it got
 * what it needed. On 2026-09-22 a lead found a record through
 * `lookup_objects`, reasoned about it correctly, and then could not write
 * anything back, because the lookup returned records without their ids. Every
 * argument check passed that run. These are the rules that would have failed.
 */

import type { CheckClock } from './checks';
import type { CaseTranscript, ToolCallRecord } from './transcripts';
import type { EvalCheck } from './types';
import { describe, expect, it } from 'vitest';
import { runCheck } from './checks';

/** 14:00 UTC on 2026-09-22, the clock every date rule here runs against. */
const CLOCK: CheckClock = { now: new Date('2026-09-22T14:00:00Z'), workspaceTimeZone: 'UTC' };

/**
 * A case transcript made of the given tool calls.
 * @param toolCalls - The calls the agent made, in order.
 */
function transcriptOf(toolCalls: ToolCallRecord[]): CaseTranscript {
  return {
    itemIndex: 0,
    item: { input: 'Ingest https://example.org/events' },
    output: 'Proposed 1 event.',
    toolCalls,
    trajectory: toolCalls.map(call => call.tool),
    traceId: null,
    latencyMs: 1200,
    errored: false,
    errorMessage: '',
    usage: null,
    caseResultId: null,
  };
}

/**
 * One `lookup_objects` call returning these records, as the tool does: a
 * JSON array in a string.
 * @param typeSlug - The object type the agent asked for.
 * @param records - What came back.
 */
function lookup(typeSlug: string, records: Array<Record<string, unknown>>): ToolCallRecord {
  return { tool: 'lookup_objects', input: { type_slug: typeSlug }, output: JSON.stringify(records) };
}

const EVENT_LOOKUP = { path: 'type_slug', equals: 'event-candidate' };

describe('toolReturned', () => {
  it('passes when every returned record carries its id', () => {
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', where: EVENT_LOOKUP, path: '*.id', present: true } };
    const outcome = runCheck(transcriptOf([lookup('event-candidate', [{ id: 41, title: 'Bluegrass' }, { id: 42, title: 'Contra Dance' }])]), check, CLOCK);

    expect(outcome?.passed).toBe(true);
  });

  it('fails when one record lacks its id, naming which one', () => {
    // The first record is fine; a rule that read only the first would pass.
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', where: EVENT_LOOKUP, path: '*.id', present: true } };
    const outcome = runCheck(transcriptOf([lookup('event-candidate', [{ id: 41, title: 'Bluegrass' }, { title: 'Contra Dance' }])]), check, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('lookup_objects returned 1.id was missing');
  });

  it('picks calls by their arguments, so a venue lookup cannot break an event rule', () => {
    // Venues have no startDate. Without `where`, this rule would fail on the
    // venue lookup every run makes alongside the event one.
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', where: EVENT_LOOKUP, path: '*.startDate', present: true } };
    const outcome = runCheck(transcriptOf([
      lookup('venue-candidate', [{ id: 7, name: 'The Old Mill' }]),
      lookup('event-candidate', [{ id: 41, startDate: '2026-10-06' }]),
    ]), check, CLOCK);

    expect(outcome?.passed).toBe(true);
  });

  it('says a sentence has no fields rather than calling each one missing', () => {
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', path: '*.id', present: true } };
    const call = { tool: 'lookup_objects', input: { type_slug: 'event-candidate' }, output: 'No records found for this type.' };
    const outcome = runCheck(transcriptOf([call]), check, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('returned text rather than JSON, so *.id cannot be read from it ("No records found for this type.")');
  });

  it('reads a text return whole when there is no path', () => {
    // fetch_url answers in prose; `contains` still has something to read.
    const call = { tool: 'fetch_url', input: { url: 'https://example.org/events' }, output: '# Events at the Grange\nhttps://example.org/events\n\nTuesday Bluegrass' };

    expect(runCheck(transcriptOf([call]), { toolReturned: { tool: 'fetch_url', contains: 'Tuesday Bluegrass' } }, CLOCK)?.passed).toBe(true);
    expect(runCheck(transcriptOf([call]), { toolReturned: { tool: 'fetch_url', contains: 'Could not fetch' } }, CLOCK)?.passed).toBe(false);
  });

  it('fails an empty list instead of passing a rule about every item of nothing', () => {
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', path: '*.id', present: true } };
    const outcome = runCheck(transcriptOf([lookup('event-candidate', [])]), check, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('reached no items');
  });

  it('judges returned dates against the run day', () => {
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', where: EVENT_LOOKUP, path: '*.startDate', onOrAfter: 'today' } };

    expect(runCheck(transcriptOf([lookup('event-candidate', [{ id: 1, startDate: '2026-09-22' }, { id: 2, startDate: '2026-10-01' }])]), check, CLOCK)?.passed).toBe(true);

    const outcome = runCheck(transcriptOf([lookup('event-candidate', [{ id: 1, startDate: '2026-10-01' }, { id: 2, startDate: '2026-09-21' }])]), check, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('lookup_objects returned 1.startDate was 2026-09-21, which is before today');
  });

  it('reads timezoneFrom out of the return, not the arguments', () => {
    // 01:30 UTC on the 23rd is still the 22nd in Vermont. Judged in UTC, a
    // "tomorrow or later" rule would pass it; judged by the zone the record
    // itself names, it is today and fails.
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', path: 'start', onOrAfter: 'tomorrow', timezoneFrom: 'timezone' } };
    const call = { tool: 'lookup_objects', input: { type_slug: 'event-candidate' }, output: JSON.stringify({ start: '2026-09-23T01:30:00Z', timezone: 'America/New_York' }) };

    expect(runCheck(transcriptOf([call]), check, CLOCK)?.passed).toBe(false);
  });

  it('judges each returned record by its own zone when timezoneFrom has a *', () => {
    // Two records, both 01:30 UTC on the 23rd. In Vermont that is still the
    // 22nd — today, so "tomorrow or later" fails; in Tokyo it is the 23rd and
    // passes. One zone for the whole return would get one of them wrong.
    const check: EvalCheck = { toolReturned: { tool: 'lookup_objects', path: '*.start', onOrAfter: 'tomorrow', timezoneFrom: '*.timezone' } };
    const tokyoOnly = [{ start: '2026-09-23T01:30:00Z', timezone: 'Asia/Tokyo' }];
    const withVermont = [...tokyoOnly, { start: '2026-09-23T01:30:00Z', timezone: 'America/New_York' }];

    expect(runCheck(transcriptOf([lookup('event-candidate', tokyoOnly)]), check, CLOCK)?.passed).toBe(true);

    const outcome = runCheck(transcriptOf([lookup('event-candidate', withVermont)]), check, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('lookup_objects returned 1.start was 2026-09-22');
  });

  it('says a return was cut short rather than calling it text', () => {
    // The run log keeps a bounded amount of each output. JSON that lost its
    // end does not parse, and blaming the tool for "answering in text" would
    // send someone to fix a tool that is fine.
    const full = JSON.stringify([{ id: 1, title: 'Bluegrass' }, { id: 2, title: 'Contra Dance' }]);
    const call = { tool: 'lookup_objects', input: { type_slug: 'event-candidate' }, output: full.slice(0, 20), outputLength: full.length };
    const outcome = runCheck(transcriptOf([call]), { toolReturned: { tool: 'lookup_objects', path: '*.id', present: true } }, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain(`lookup_objects's return was ${full.length} characters and only the first 20 were kept`);
  });

  it('fails by default when the tool was never called', () => {
    // The playbook looks events up before every run; skipping it is how
    // duplicates reach the queue.
    const outcome = runCheck(transcriptOf([]), { toolReturned: { tool: 'lookup_objects', path: '*.id', present: true } }, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('Never called lookup_objects');
  });

  it('scores under its own slug, apart from an argument rule on the same path', () => {
    const condition = { tool: 'lookup_objects', path: 'type_slug', present: true };
    const calls = [lookup('event-candidate', [{ id: 1 }])];

    expect(runCheck(transcriptOf(calls), { toolReturned: condition }, CLOCK)?.slug).toBe('check:toolReturned:lookup_objects.type_slug:present=true');
    expect(runCheck(transcriptOf(calls), { toolCalledWith: condition }, CLOCK)?.slug).toBe('check:toolCalledWith:lookup_objects.type_slug:present=true');
  });
});

describe('a * path on toolCalledWith', () => {
  it('holds every item of a list argument to the rule, and names the one that broke it', () => {
    const call = {
      tool: 'propose_action',
      input: { action_input: { fields: { performers: [{ name: 'The Grange Band' }, { name: '' }] } } },
      output: 'Proposed',
    };
    const outcome = runCheck(transcriptOf([call]), { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.performers.*.name', present: true } }, CLOCK);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('propose_action.action_input.fields.performers.1.name was missing');
  });
});
