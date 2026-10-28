/**
 * One name for the client everywhere, and the authors who sign its pages.
 * Every client and person here is fictional.
 */
import { describe, expect, it } from 'vitest';
import { anchorNamedAs, cleanAuthors, defaultAuthor, sameName } from './DataRoomService';

describe('the entity carries the project\'s name', () => {
  it('reads the same name cased or spelled another way as the same name', () => {
    expect(sameName('NorthWind', 'Northwind')).toBe(true);
    expect(sameName('Northwind Home-Services', 'northwind home services')).toBe(true);
    expect(sameName('Northwind', 'Kestrel Capital')).toBe(false);
    expect(sameName('', '')).toBe(false);
  });

  it('an anchor naming the client, or naming nothing, takes the project\'s spelling (onboarding: "Northwind" beside "NorthWind")', () => {
    expect(anchorNamedAs('Northwind', { type: 'client', label: 'NorthWind' })).toEqual({ type: 'client', label: 'Northwind' });
    expect(anchorNamedAs('Northwind', { type: 'client' })).toEqual({ type: 'client', label: 'Northwind' });
  });

  it('a label naming something else is kept', () => {
    expect(anchorNamedAs('Northwind', { type: 'deal', label: 'Northwind — Hiring agents' })).toEqual({ type: 'deal', label: 'Northwind — Hiring agents' });
  });
});

describe('the client\'s authors', () => {
  it('keeps each name once and one default at most', () => {
    const kept = cleanAuthors([
      { name: ' Dana Reyes ', default: true },
      { name: 'dana reyes', title: 'duplicate' },
      { name: 'Sam Okafor', default: true, topics: ['heat pumps', ' '] },
      { name: '' },
    ]);

    expect(kept).toEqual([{ name: 'Dana Reyes', default: true }, { name: 'Sam Okafor', topics: ['heat pumps'] }]);
  });

  it('the default byline: the one marked, else the only author, else none', () => {
    expect(defaultAuthor([{ name: 'Dana Reyes' }, { name: 'Sam Okafor', default: true }])?.name).toBe('Sam Okafor');
    expect(defaultAuthor([{ name: 'Dana Reyes' }])?.name).toBe('Dana Reyes');
    expect(defaultAuthor([{ name: 'Dana Reyes' }, { name: 'Sam Okafor' }])).toBeNull();
    expect(defaultAuthor(undefined)).toBeNull();
  });
});
