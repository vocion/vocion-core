/**
 * Refusing eval checks that read a `propose_action` argument nobody sends.
 *
 * Every case here is a typo or a wrong guess about the payload that used to
 * apply cleanly and then fail every run with "was missing" — indistinguishable
 * from an agent that really did leave the field out.
 */

import type { LoadedEvalDataset, LoadedObjectType } from './loader';
import { describe, expect, it } from 'vitest';
import { assertEvalCheckPaths } from './evalCheckPaths';

const EVENT_TYPE = {
  slug: 'event-candidate',
  label: 'Event candidate',
  schema: { type: 'object', properties: { title: {}, start: {}, startDate: {}, timezone: {}, recurrence: {}, categories: {} } },
} as unknown as LoadedObjectType;

const VENUE_TYPE = {
  slug: 'venue-candidate',
  label: 'Venue candidate',
  schema: { type: 'object', properties: { name: {}, city: {} } },
} as unknown as LoadedObjectType;

const OBJECT_TYPES = [EVENT_TYPE, VENUE_TYPE];

/**
 * One dataset with one case carrying the given `toolCalledWith` bodies.
 * @param conditions - The checks to author.
 */
function datasetWith(...conditions: Array<Record<string, unknown>>): LoadedEvalDataset {
  return {
    slug: 'event-extraction',
    name: 'Event extraction',
    agentSlug: 'event-ingestion-lead',
    items: [{ input: 'Ingest', checks: conditions.map(condition => ({ toolCalledWith: { tool: 'propose_action', ...condition } })) }],
  } as unknown as LoadedEvalDataset;
}

const EVENTS_ONLY = { path: 'action_input.objectType', equals: 'event-candidate' };

describe('assertEvalCheckPaths', () => {
  it('accepts the paths the Veerio datasets actually use', () => {
    expect(() => assertEvalCheckPaths([datasetWith(
      { where: EVENTS_ONLY, path: 'action_input.dedupOn', equals: ['title', 'startDate', 'venueName'] },
      { path: 'suggested_decision', present: true },
      { where: [EVENTS_ONLY, { path: 'action_input.fields.recurrence', present: false }], path: 'action_input.fields.startDate', onOrAfter: 'today', timezoneFrom: 'action_input.fields.timezone' },
      { where: { path: 'action_input.objectType', equals: 'venue-candidate' }, path: 'action_input.fields.name', present: true },
    )], OBJECT_TYPES)).not.toThrow();
  });

  it('refuses a misspelled top-level argument and lists the real ones', () => {
    expect(() => assertEvalCheckPaths([datasetWith({ path: 'suggested_decison', present: true })], OBJECT_TYPES))
      .toThrow(/propose_action takes no argument "suggested_decison"; it takes .*suggested_decision/);
  });

  it('refuses a misspelled envelope key inside action_input', () => {
    // `feilds` is the typo that looks right at a glance.
    expect(() => assertEvalCheckPaths([datasetWith({ path: 'action_input.feilds.startDate', present: true })], OBJECT_TYPES))
      .toThrow(/action_input has no "feilds"/);
  });

  it('refuses a field the pinned object type does not have, naming its fields', () => {
    // `date` is a reasonable guess and not what event-candidate calls it.
    expect(() => assertEvalCheckPaths([datasetWith({ where: EVENTS_ONLY, path: 'action_input.fields.date', onOrAfter: 'today' })], OBJECT_TYPES))
      .toThrow(/object type "event-candidate" has no field "date"; its fields are .*startDate/);
  });

  it('refuses a field that belongs to the other object type than the one pinned', () => {
    // `name` is a venue field; an event rule reading it would never match.
    expect(() => assertEvalCheckPaths([datasetWith({ where: EVENTS_ONLY, path: 'action_input.fields.name', present: true })], OBJECT_TYPES))
      .toThrow(/"event-candidate" has no field "name"/);
  });

  it('accepts a field some object type has when the check pins none', () => {
    expect(() => assertEvalCheckPaths([datasetWith({ path: 'action_input.fields.city', present: true })], OBJECT_TYPES)).not.toThrow();
  });

  it('refuses a field no object type has when the check pins none', () => {
    expect(() => assertEvalCheckPaths([datasetWith({ path: 'action_input.fields.stratDate', present: true })], OBJECT_TYPES))
      .toThrow(/no object type in this workspace has a field "stratDate"/);
  });

  it('refuses a where that pins an object type the workspace does not define', () => {
    expect(() => assertEvalCheckPaths([datasetWith({ where: { path: 'action_input.objectType', equals: 'event' }, path: 'action_input.fields.title', present: true })], OBJECT_TYPES))
      .toThrow(/object type "event", which this workspace does not define/);
  });

  it('checks where paths and timezoneFrom, not only path', () => {
    expect(() => assertEvalCheckPaths([datasetWith({ where: { path: 'action_input.objecttype', equals: 'event-candidate' }, path: 'action_input.title', present: true })], OBJECT_TYPES))
      .toThrow(/where path "action_input.objecttype"/);
    expect(() => assertEvalCheckPaths([datasetWith({ where: EVENTS_ONLY, path: 'action_input.fields.startDate', onOrAfter: 'today', timezoneFrom: 'action_input.fields.tz' })], OBJECT_TYPES))
      .toThrow(/timezoneFrom "action_input.fields.tz"/);
  });

  it('lists every problem at once, with the dataset, case and check', () => {
    // One push should surface all of them, not one per round trip.
    let message = '';
    try {
      assertEvalCheckPaths([datasetWith({ path: 'suggested_decison', present: true }, { where: EVENTS_ONLY, path: 'action_input.fields.date', present: true })], OBJECT_TYPES);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('eval dataset "event-extraction" case 1 check 1');
    expect(message).toContain('case 1 check 2');
  });

  it('leaves alone what it cannot know', () => {
    // Another tool's arguments, another action's payload, and a path into an
    // object a field holds are all outside what core can see offline.
    const otherTool = { toolCalledWith: { tool: 'fetch_url', path: 'anything.at.all', present: true } };
    const dataset = { ...datasetWith(
      { where: { path: 'action_id', equals: 'hubspot.update' }, path: 'action_input.properties.dealstage', present: true },
      { where: EVENTS_ONLY, path: 'action_input.fields.categories.0', present: true },
    ) };
    dataset.items[0]!.checks!.push(otherTool as never);

    expect(() => assertEvalCheckPaths([dataset], OBJECT_TYPES)).not.toThrow();
  });

  it('accepts any field on a type whose schema declares no properties', () => {
    const loose = { slug: 'note', label: 'Note', schema: { type: 'object' } } as unknown as LoadedObjectType;

    expect(() => assertEvalCheckPaths([datasetWith({ where: { path: 'action_input.objectType', equals: 'note' }, path: 'action_input.fields.whatever', present: true })], [loose])).not.toThrow();
  });
});
