import { describe, expect, it } from 'vitest';
import { composerAsk, firstNameOf, greetingFor, isReturning, mayDockCard, partOfDay, teamLine, teamOf, waitingNudgeCount } from './emptyChat';

/**
 * How a conversation starts, as one rule every surface reads (founder,
 * 2026-10-08: "Not jump right to big asks. Maybe a soft nudge or chip.").
 */
describe('how a conversation starts', () => {
  it('docks a card on an empty conversation only when the person started its flow', () => {
    expect(mayDockCard({ messageCount: 0, personStarted: false })).toBe(false);
    expect(mayDockCard({ messageCount: 0, personStarted: true })).toBe(true);
    expect(mayDockCard({ messageCount: 2, personStarted: false })).toBe(true);
  });

  it('says what waits as one count, until the person waves it away', () => {
    expect(waitingNudgeCount({ waiting: 3, dismissed: false })).toBe(3);
    expect(waitingNudgeCount({ waiting: 3, dismissed: true })).toBeNull();
    expect(waitingNudgeCount({ waiting: 0, dismissed: false })).toBeNull();
  });

  it('says one line, varied by the time and by a return', () => {
    const t = (key: string, values?: Record<string, string>) => `${key}${values ? ` ${JSON.stringify(values)}` : ''}`;

    expect(greetingFor({ hour: 20, returning: false, firstName: 'Sam' }, t)).toBe('greeting_named {"part":"evening","name":"Sam"}');
    expect(greetingFor({ hour: 9, returning: false }, t)).toBe('greeting {"part":"morning"}');
    expect(greetingFor({ hour: 9, returning: true, firstName: 'Sam' }, t)).toBe('welcome_back_named {"name":"Sam"}');
    expect(greetingFor({ hour: 9, returning: true, firstName: null }, t)).toBe('welcome_back');
  });

  it('counts as a return only after a while away', () => {
    const now = Date.now();

    expect(isReturning(null, now)).toBe(false);
    expect(isReturning(now - 60_000, now)).toBe(false);
    expect(isReturning(now - 7 * 60 * 60 * 1000, now)).toBe(true);
  });

  it('greets by the person\'s clock and first name, never an email address', () => {
    expect(partOfDay(8)).toBe('morning');
    expect(partOfDay(14)).toBe('afternoon');
    expect(partOfDay(21)).toBe('evening');
    expect(partOfDay(3)).toBe('evening');
    expect(firstNameOf('Sam Rivera')).toBe('Sam');
    expect(firstNameOf('sam@northwind.example')).toBeNull();
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });
});

describe('your team is here (founder, 2026-10-09)', () => {
  const t = (key: string, values?: Record<string, string>) => `${key}${values ? ` ${JSON.stringify(values)}` : ''}`;
  const lead = { slug: 'lead', name: 'Workspace lead' };
  const analyst = { slug: 'analyst', name: 'Pipeline Analyst' };

  it('puts the lead first and leaves out the virtual search entry', () => {
    expect(teamOf([analyst, { slug: '__search__', name: 'Search only' }, lead], 'lead').members.map(m => m.slug)).toEqual(['lead', 'analyst']);
    expect(teamOf([], 'lead')).toEqual({ lead: null, members: [] });
  });

  it('asks the team, or the one agent by name', () => {
    expect(composerAsk([lead, analyst], t)).toBe('ask_team');
    expect(composerAsk([lead], t)).toBe('ask_agent {"name":"Workspace lead"}');
  });

  it('says the team is on it, or the one agent is', () => {
    expect(teamLine({ workspace: 'Northwind', members: [lead, analyst] }, t)).toBe('team_on_it {"workspace":"Northwind"}');
    expect(teamLine({ workspace: 'Personal', members: [{ slug: 'assistant', name: 'Assistant' }] }, t)).toBe('agent_on_it {"name":"Assistant"}');
    expect(teamLine({ workspace: 'Northwind', members: [] }, t)).toBeNull();

    // A lead with a given name speaks for the team; the composer still asks the team.
    const ava = { slug: 'workspace-lead', name: 'Ava', givenName: 'Ava', leadLabel: 'Ava · Revenue lead' };

    expect(teamLine({ workspace: 'Revenue', members: [ava, analyst] }, t)).toBe('named_lead_and_team_on_it {"name":"Ava"}');
    expect(composerAsk([ava, analyst], t)).toBe('ask_team');
    expect(composerAsk([ava], t)).toBe('ask_agent {"name":"Ava"}');
  });
});
