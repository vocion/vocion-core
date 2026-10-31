import { describe, expect, it } from 'vitest';
import { DASHBOARD_ROUTES } from '@/features/navigation/dashboardNav';
import { fillPath, findWhereTo, WHERE_TO, whereTo, whereToLine } from './whereTo';

/** Routes real pages serve that the registry does not list as sidebar rows. */
const DYNAMIC_OK = [/^\/dashboard\/projects\/\{id\}$/, /^\/dashboard\/connectors\/\{slug\}$/, /^\/dashboard\/conversations$/];

describe('where-to registry', () => {
  it('has unique intents and a route the app actually serves for every one', () => {
    const intents = WHERE_TO.map(w => w.intent);

    expect(new Set(intents).size).toBe(intents.length);

    const known = new Set(DASHBOARD_ROUTES.map(r => r.url));
    for (const w of WHERE_TO) {
      const bare = w.path.split('?')[0]!;
      const ok = known.has(w.path) || known.has(bare) || DYNAMIC_OK.some(re => re.test(bare));

      expect(ok, `${w.intent} → ${w.path}`).toBe(true);
      expect(w.instruction.length).toBeGreaterThan(20);
    }
  });

  it('finds the Zoom re-authorisation from the words in the error', () => {
    const [first] = findWhereTo('zoom scopes 4711');

    expect(first?.intent).toBe('reconnect-zoom');
    expect(whereTo('reconnect-zoom')?.path).toBe('/dashboard/connectors');
  });

  it('ranks the best match first and returns nothing for gibberish', () => {
    expect(findWhereTo('approve proposal')[0]?.intent).toBe('review-proposals');
    expect(findWhereTo('xqzv')).toEqual([]);
  });

  it('distinguishes taught automations from schedules by their public names', () => {
    expect(findWhereTo('automations')[0]?.path).toBe('/dashboard/automations');
    expect(findWhereTo('schedules')[0]?.path).toBe('/dashboard/schedules');
  });

  it('fills a project id into the link and writes the line the chat renders as a chip', () => {
    const w = whereTo('open-project')!;

    expect(fillPath(w.path, { id: '21' })).toBe('/dashboard/projects/21');
    expect(fillPath(w.path)).toBe('/dashboard/projects/{id}');
    expect(whereToLine(w, { id: '21' })).toMatch(/^\[Open one project\]\(\/dashboard\/projects\/21\) — /);
  });
});
