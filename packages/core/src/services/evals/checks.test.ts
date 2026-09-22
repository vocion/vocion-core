import type { CaseTranscript } from './transcripts';
import type { EvalCheck } from './types';
import { describe, expect, it } from 'vitest';
import { runCheck, scoreChecks } from './checks';

function transcript(overrides: Partial<CaseTranscript> = {}): CaseTranscript {
  return {
    itemIndex: 0,
    item: { input: 'refund my order 4471' },
    output: 'Refunded $42.10, back within 3-5 business days.',
    toolCalls: [],
    trajectory: ['lookup_order', 'issue_refund'],
    traceId: null,
    latencyMs: 1200,
    errored: false,
    errorMessage: '',
    usage: { model: 'm', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cents: 1, turns: 3, toolCalls: 2 },
    caseResultId: null,
    ...overrides,
  };
}

/**
 * A transcript of an ingestion run that proposed events, which is where the
 * argument checks earn their keep: the rules that got broken in production
 * were all inside `action_input`, where nothing could see them.
 * @param calls - The propose_action arguments, one entry per call.
 */
function proposalTranscript(calls: Array<Record<string, unknown>>): CaseTranscript {
  return transcript({
    toolCalls: [
      { tool: 'fetch_url', input: { url: 'https://example.org/events' }, output: 'page text' },
      ...calls.map(input => ({ tool: 'propose_action', input, output: 'proposed' })),
    ],
    trajectory: ['fetch_url', ...calls.map(() => 'propose_action')],
  });
}

/**
 * One well-formed proposal, as the playbook says it must look.
 * @param overrides - What this particular case gets wrong, if anything.
 */
function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: 'objects.propose_candidate',
    suggested_decision: 'approve',
    suggested_decision_reason: 'Upcoming, on an approved source, venue already known.',
    action_input: {
      objectType: 'event-candidate',
      title: 'Tuesday Bluegrass',
      dedupOn: ['title', 'startDate', 'venueName'],
      fields: { startDate: '2026-10-06', categories: ['Live Music'] },
    },
    ...overrides,
  };
}

/**
 * A venue proposal, which rides the same tool with a different payload —
 * different dedup key, no categories. Any rule about events has to survive
 * one of these sitting beside it in the same run.
 * @param overrides - What this particular case gets wrong, if anything.
 */
function venueProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: 'objects.propose_candidate',
    suggested_decision: 'approve',
    suggested_decision_reason: 'New venue, address read from its own site.',
    action_input: {
      objectType: 'venue-candidate',
      title: 'Nectar\'s, Burlington',
      dedupOn: ['name', 'city'],
      fields: { name: 'Nectar\'s', city: 'Burlington', addressLine1: '188 Main St' },
    },
    ...overrides,
  };
}

/** Only the event proposals, which is what most rules here are about. */
const EVENT_PROPOSALS = { path: 'action_input.objectType', equals: 'event-candidate' };

describe('runCheck', () => {
  it('passes toolCalled when the tool is in the trajectory and fails when it is not', () => {
    expect(runCheck(transcript(), { toolCalled: 'issue_refund' })?.passed).toBe(true);
    expect(runCheck(transcript(), { toolCalled: 'escalate' })?.passed).toBe(false);
  });

  it('names the tools actually used when toolCalled fails', () => {
    // A bare "failed" tells an engineer nothing; the whole point of a
    // deterministic check is that it can say exactly what happened instead.
    const outcome = runCheck(transcript(), { toolCalled: 'escalate' });

    expect(outcome?.explanation).toContain('lookup_order');
    expect(outcome?.explanation).toContain('issue_refund');
  });

  it('passes toolNotCalled only when the forbidden tool was avoided', () => {
    expect(runCheck(transcript(), { toolNotCalled: 'delete_account' })?.passed).toBe(true);
    expect(runCheck(transcript(), { toolNotCalled: 'issue_refund' })?.passed).toBe(false);
  });

  it('fails outputMatches when the pattern does not match', () => {
    // The check that matters. An operator that only ever passes is decorative,
    // and this suite would not catch a regression that made it always return
    // true.
    expect(runCheck(transcript(), { outputMatches: String.raw`\$[0-9,]+\.[0-9]{2}` })?.passed).toBe(true);
    expect(runCheck(transcript(), { outputMatches: String.raw`^Sorry` })?.passed).toBe(false);
  });

  it('reports an invalid regular expression as an authoring mistake, not an agent failure', () => {
    const outcome = runCheck(transcript(), { outputMatches: '([unclosed' });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('Invalid regular expression');
  });

  it('passes outputNotContains only when the phrase is absent', () => {
    expect(runCheck(transcript(), { outputNotContains: 'I don\'t have access' })?.passed).toBe(true);
    expect(runCheck(transcript(), { outputNotContains: 'Refunded' })?.passed).toBe(false);
  });

  it('compares latency against the budget rather than reporting it', () => {
    expect(runCheck(transcript({ latencyMs: 900 }), { latencyUnderMs: 1000 })?.passed).toBe(true);
    expect(runCheck(transcript({ latencyMs: 4000 }), { latencyUnderMs: 1000 })?.passed).toBe(false);
  });

  it('treats a case with no recorded usage as zero turns rather than crashing', () => {
    // Errored and unpriced runs both leave usage null; a check that throws
    // here would take down the whole run over a missing number.
    expect(runCheck(transcript({ usage: null }), { turnsUnder: 2 })?.passed).toBe(true);
  });

  it('reads the dedup key out of the call arguments and fails when its fields are out of order', () => {
    // The key is [title, startDate, venueName] in that order — a different
    // order is a different key, and the run that got this wrong on
    // 2026-09-08 lost five rows to it.
    const right = proposalTranscript([proposal()]);
    const wrong = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', dedupOn: ['startDate', 'title', 'venueName'] } })]);
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.dedupOn', equals: ['title', 'startDate', 'venueName'] } };

    expect(runCheck(right, check)?.passed).toBe(true);
    expect(runCheck(wrong, check)?.passed).toBe(false);
  });

  it('fails when the dedup key is buried inside the payload instead of at the top level', () => {
    // Exactly the 2026-09-08 mistake: the key was authored, so a check that
    // only asked "is dedupOn anywhere in the arguments" would have passed it.
    const buried = proposalTranscript([{
      action_id: 'objects.propose_candidate',
      action_input: { title: 'Tuesday Bluegrass', fields: { dedupOn: ['title', 'startDate', 'venueName'] } },
    }]);

    const outcome = runCheck(buried, { toolCalledWith: { tool: 'propose_action', path: 'action_input.dedupOn', present: true } });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('dedupOn');
  });

  it('holds every proposal to carrying a suggested decision, not just the first one', () => {
    // A run that gets it right once and forgets on the second card is the
    // failure worth catching; `every` is the default for that reason.
    const mixed = proposalTranscript([
      proposal(),
      proposal({ suggested_decision: undefined, suggested_decision_reason: undefined }),
    ]);

    const outcome = runCheck(mixed, { toolCalledWith: { tool: 'propose_action', path: 'suggested_decision', present: true } });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('1 of 2');
  });

  it('refuses a category the enum does not contain', () => {
    // A model inventing "Concert" makes a card that fails validation
    // downstream, where the failure is someone else's to debug.
    const categories = ['Live Music', 'Arts & Culture', 'Community'];
    const invented = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { categories: ['Live Music', 'Concert'] } } })]);
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.categories', subsetOf: categories } };

    expect(runCheck(proposalTranscript([proposal()]), check)?.passed).toBe(true);

    const outcome = runCheck(invented, check);

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('Concert');
  });

  it('accepts one matching call when the case asks for some rather than every', () => {
    const mixed = proposalTranscript([proposal({ suggested_decision: 'reject' }), proposal()]);
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'suggested_decision', equals: 'reject', calls: 'some' } };

    expect(runCheck(mixed, check)?.passed).toBe(true);
  });

  it('fails an argument check when the tool was never called at all', () => {
    // Vacuously passing here would turn "the agent proposed nothing" into a
    // green check, which is the silence this check exists to break.
    const nothingProposed = proposalTranscript([]);

    const outcome = runCheck(nothingProposed, { toolCalledWith: { tool: 'propose_action', path: 'action_input.dedupOn', present: true } });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('Never called propose_action');
  });

  it('counts calls so a correction refreshes one card instead of opening a second', () => {
    // Why the key uses startDate and not start. A door-time change cost a
    // duplicate card on 2026-09-05.
    const once = proposalTranscript([proposal()]);
    const twice = proposalTranscript([proposal(), proposal({ suggested_decision_reason: 'Door time changed.' })]);
    const check: EvalCheck = { toolCallCount: { tool: 'propose_action', max: 1 } };

    expect(runCheck(once, check)?.passed).toBe(true);
    expect(runCheck(twice, check)?.passed).toBe(false);
  });

  it('reports a count check with no bound as an authoring mistake rather than an agent failure', () => {
    const outcome = runCheck(proposalTranscript([proposal()]), { toolCallCount: { tool: 'propose_action' } });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('nothing to compare against');
  });

  it('does not mistake a list for an object whose keys happen to be 0 and 1', () => {
    // Object.keys(['a']) is ['0'], so a loose comparison would call
    // { 0: 'title' } equal to ['title'] and report a rule kept that nobody
    // checked — the worst thing a check can do.
    const called = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', dedupOn: ['title', 'startDate'] } })]);

    const outcome = runCheck(called, {
      toolCalledWith: { tool: 'propose_action', path: 'action_input.dedupOn', equals: { 0: 'title', 1: 'startDate' } },
    });

    expect(outcome?.passed).toBe(false);
  });

  it('says so when subsetOf is pointed at something that is not a list', () => {
    // Comparing "Live Music, Community" as one long value, or an object as
    // "[object Object]", answers a question nobody asked.
    const joined = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { categories: 'Live Music, Community' } } })]);

    const outcome = runCheck(joined, {
      toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.categories', subsetOf: ['Live Music', 'Community'] },
    });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('not a list');
  });

  it('holds a rule about events without failing on the venue proposal beside it', () => {
    // propose_action files both. An event's dedup key is
    // [title, startDate, venueName]; a venue's is [name, city]. Without
    // `where`, the event rule fails on every run that proposed a venue —
    // which is most real runs, and would read as the agent being broken.
    const run = proposalTranscript([venueProposal(), proposal()]);

    const outcome = runCheck(run, {
      toolCalledWith: { tool: 'propose_action', where: EVENT_PROPOSALS, path: 'action_input.dedupOn', equals: ['title', 'startDate', 'venueName'] },
    });

    expect(outcome?.passed).toBe(true);
  });

  it('still catches a wrong key on one event when another event is right', () => {
    // `where` narrows which calls a rule is about; it must not weaken the
    // rule to "one of them was fine".
    const run = proposalTranscript([
      proposal(),
      proposal({ action_input: { objectType: 'event-candidate', dedupOn: ['title', 'start', 'venueName'] } }),
    ]);

    const outcome = runCheck(run, {
      toolCalledWith: { tool: 'propose_action', where: EVENT_PROPOSALS, path: 'action_input.dedupOn', equals: ['title', 'startDate', 'venueName'] },
    });

    expect(outcome?.passed).toBe(false);
  });

  it('lets a rule about something that does not always happen pass when it did not', () => {
    // A venue is proposed only when it is new. "If you proposed one, its key
    // was [name, city]" is true of a run that proposed none.
    const eventsOnly = proposalTranscript([proposal()]);
    const check: EvalCheck = {
      toolCalledWith: {
        tool: 'propose_action',
        where: { path: 'action_input.objectType', equals: 'venue-candidate' },
        noCalls: 'pass',
        path: 'action_input.dedupOn',
        equals: ['name', 'city'],
      },
    };

    expect(runCheck(eventsOnly, check)?.passed).toBe(true);

    const withBadVenue = proposalTranscript([
      venueProposal({ action_input: { objectType: 'venue-candidate', dedupOn: ['name'] } }),
      proposal(),
    ]);

    // And it still bites when the thing did happen, wrongly.
    expect(runCheck(withBadVenue, check)?.passed).toBe(false);
  });

  it('skips an operator it does not recognise instead of failing the run', () => {
    // A manifest written against a newer build must not break this one.
    const unknown = { somethingNew: 'value' } as unknown as EvalCheck;

    expect(runCheck(transcript(), unknown)).toBeNull();
  });
});

describe('scoreChecks', () => {
  it('produces one score per check, marked pass or fail', () => {
    const scores = scoreChecks(transcript({
      item: {
        input: 'refund my order 4471',
        checks: [{ toolCalled: 'issue_refund' }, { outputContains: 'never said this' }],
      },
    }));

    expect(scores).toHaveLength(2);
    expect(scores[0]?.value).toBe(1);
    expect(scores[0]?.label).toBe('pass');
    expect(scores[1]?.value).toBe(0);
    expect(scores[1]?.label).toBe('fail');
  });

  it('files every score against its own case', () => {
    const scores = scoreChecks(transcript({
      itemIndex: 7,
      item: { input: 'x', checks: [{ toolCalled: 'lookup_order' }] },
    }));

    expect(scores[0]?.itemIndex).toBe(7);
  });

  it('checks nothing on a case whose agent run threw', () => {
    // "Did not call the refund tool" is true of a crashed run and says nothing
    // about the agent. Reporting it as a failed check is noise that reads like
    // a finding.
    const scores = scoreChecks(transcript({
      errored: true,
      output: '',
      trajectory: [],
      item: { input: 'x', checks: [{ toolCalled: 'issue_refund' }] },
    }));

    expect(scores).toEqual([]);
  });

  it('gives two checks on the same argument different slugs', () => {
    // "The key is there" and "the key is this exact list" are two rules. With
    // one slug their score rows merged on every per-evaluator view, so a
    // passing presence check hid a failing value check.
    const run = proposalTranscript([proposal()]);
    const isThere = runCheck(run, { toolCalledWith: { tool: 'propose_action', path: 'action_input.dedupOn', present: true } });
    const isExact = runCheck(run, { toolCalledWith: { tool: 'propose_action', path: 'action_input.dedupOn', equals: ['title', 'startDate', 'venueName'] } });
    const atMostOne = runCheck(run, { toolCallCount: { tool: 'propose_action', max: 1 } });
    const exactlyOne = runCheck(run, { toolCallCount: { tool: 'propose_action', exactly: 1 } });

    expect(isThere?.slug).not.toBe(isExact?.slug);
    expect(atMostOne?.slug).not.toBe(exactlyOne?.slug);
  });

  it('fails a proposal whose day is before today, with today resolved when the check runs', () => {
    // Playbook: only upcoming events reach the queue. The listing's contents
    // roll over, so the rule has to be relative to the run, not a fixed date.
    const now = new Date('2026-09-22T16:00:00Z');
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezone: 'America/New_York' } };
    const upcoming = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22' } } })]);
    const past = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-21' } } })]);

    expect(runCheck(upcoming, check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(true);

    const outcome = runCheck(past, check, { now, workspaceTimeZone: 'UTC' });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('2026-09-21');
  });

  it('lets two date fields on one call use different zones', () => {
    // At 9:30pm Eastern it is already tomorrow in UTC. The venue-local day
    // holds against Eastern "today"; the same day fails against UTC's, which
    // is why the zone sits on each check rather than on the dataset.
    const now = new Date('2026-09-23T01:30:00Z');
    const tonight = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22' } } })]);
    const eastern: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezone: 'America/New_York' } };
    const utc: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezone: 'utc' } };

    expect(runCheck(tonight, eastern, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(true);
    expect(runCheck(tonight, utc, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(false);
  });

  it('fails a date argument that is not a date instead of passing it', () => {
    const now = new Date('2026-09-22T16:00:00Z');
    const vague = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: 'next Friday' } } })]);
    const outcome = runCheck(vague, { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today' } }, { now, workspaceTimeZone: 'UTC' });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('not a date');
  });

  it('holds a window with both bounds', () => {
    // "Nothing more than a year out" is how a mis-parsed year shows up.
    const now = new Date('2026-09-22T16:00:00Z');
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', onOrBefore: 'next year' } };
    const typoYear = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2062-09-26' } } })]);

    expect(runCheck(typoYear, check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(false);
  });

  it('steps around a series refresh, whose first startDate may be in the past on purpose', () => {
    // deduplicate-event tells the agent to refresh a series card with its
    // first startDate "even when that day has passed". A series is the only
    // event proposal carrying a recurrence, so filtering on it keeps the rule
    // for single dates without punishing the refresh.
    const now = new Date('2026-10-05T16:00:00Z');
    const check: EvalCheck = {
      toolCalledWith: {
        tool: 'propose_action',
        where: [
          { path: 'action_input.objectType', equals: 'event-candidate' },
          { path: 'action_input.fields.recurrence', present: false },
        ],
        noCalls: 'pass',
        path: 'action_input.fields.startDate',
        onOrAfter: 'today',
        timezone: 'America/New_York',
      },
    };
    const seriesRefresh = proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-01', recurrence: 'every Tuesday through 2026-10-27' } } });
    const pastSingle = proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-01', recurrence: '' } } });

    expect(runCheck(proposalTranscript([seriesRefresh]), check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(true);
    expect(runCheck(proposalTranscript([seriesRefresh, pastSingle]), check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(false);
  });

  it('names every filter in the slug, so a filtered and an unfiltered rule stay apart', () => {
    const run = proposalTranscript([proposal()]);
    const plain = runCheck(run, { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today' } });
    const filtered = runCheck(run, { toolCalledWith: { tool: 'propose_action', where: { path: 'action_input.fields.recurrence', present: false }, path: 'action_input.fields.startDate', onOrAfter: 'today' } });

    expect(filtered?.slug).toContain('recurrence present=false');
    expect(filtered?.slug).not.toBe(plain?.slug);
  });

  it('judges each event by the zone it carries when timezoneFrom points at one', () => {
    // Two venues, one run, 1:30am UTC on Sept 23. It is still the 22nd in
    // Vermont and already the 23rd in Tokyo, so the same startDate is today
    // for one and yesterday for the other.
    const now = new Date('2026-09-23T01:30:00Z');
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezoneFrom: 'action_input.fields.timezone', timezone: 'utc' } };
    const vermont = proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22', timezone: 'America/New_York' } } });
    const tokyo = proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22', timezone: 'Asia/Tokyo' } } });

    expect(runCheck(proposalTranscript([vermont]), check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(true);
    expect(runCheck(proposalTranscript([tokyo]), check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(false);
  });

  it('falls back to the check\'s own timezone when the call names no real zone', () => {
    // A missing or made-up zone must not silently become UTC-or-whatever; it
    // becomes the rule the author wrote.
    const now = new Date('2026-09-23T01:30:00Z');
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezoneFrom: 'action_input.fields.timezone', timezone: 'America/New_York' } };
    const noZone = proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22' } } });
    const badZone = proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22', timezone: 'Vermont' } } });

    expect(runCheck(proposalTranscript([noZone]), check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(true);
    expect(runCheck(proposalTranscript([badZone]), check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(true);
  });

  it('reads timezone: workspace as the workspace\'s own zone', () => {
    const now = new Date('2026-09-23T01:30:00Z');
    const check: EvalCheck = { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezone: 'workspace' } };
    const tonight = proposalTranscript([proposal({ action_input: { objectType: 'event-candidate', fields: { startDate: '2026-09-22' } } })]);

    expect(runCheck(tonight, check, { now, workspaceTimeZone: 'America/New_York' })?.passed).toBe(true);
    expect(runCheck(tonight, check, { now, workspaceTimeZone: 'UTC' })?.passed).toBe(false);
  });

  it('keeps a date check\'s slug when only its zone changes', () => {
    // The zone is how the rule is judged. Changing it must not reset the
    // rule's history by renaming it.
    const run = proposalTranscript([proposal()]);
    const utc = runCheck(run, { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezone: 'utc' } });
    const venue = runCheck(run, { toolCalledWith: { tool: 'propose_action', path: 'action_input.fields.startDate', onOrAfter: 'today', timezone: 'America/New_York', timezoneFrom: 'action_input.fields.timezone' } });

    expect(venue?.slug).toBe(utc?.slug);
  });

  it('returns nothing for a case that authored no checks', () => {
    expect(scoreChecks(transcript())).toEqual([]);
  });
});
