/**
 * The doorway-page check: two location pages that are one page with the city
 * swapped fail; two that say something true of their own place pass. Every
 * business and place here is fictional.
 */
import { describe, expect, it } from 'vitest';
import { bodyText, locationPageSimilarity, maskPlaces, nearDuplicates, queryNamesLocation } from './duplicates';

const template = (city: string, extra = '') => `# Water heater repair in ${city}

Northwind Home Services repairs tank and tankless water heaters across ${city}. Our licensed plumbers arrive the same day, diagnose the fault, and quote before any work starts.

## Why ${city} homeowners call us

- Same-day visits anywhere in ${city}
- Upfront pricing with no call-out fee
- A one-year warranty on every repair

## Common water heater problems

No hot water usually means a failed heating element or a pilot that will not stay lit. Rumbling means sediment has built up in the tank and needs a flush. A leak at the base often means the tank itself has failed and needs replacing.

${extra}

[Book a repair](https://northwind-home.example/book)`;

const local = (city: string) => `# Water heater repair in ${city}

${city} sits on hard well water, so tanks here scale up in half the usual time. Last spring we replaced forty anode rods on the ridge side of ${city} alone, and the lake-front homes built before 1990 still run the original gas lines our crews re-pipe to code.

## Recent ${city} jobs

A family near the old mill had a tankless unit that kept tripping on cold mornings; we fitted a recirculation loop and a freeze kit. A rental on the harbour road needed a forty-gallon replacement the same afternoon the tenant called, permit pulled and inspected the next day.

## What ${city} customers say

"Arrived within two hours and explained the scale problem with our water" — a review left by a customer in ${city}, rated five stars.`;

describe('locationPageSimilarity', () => {
  it('sees through a swapped city name', () => {
    expect(locationPageSimilarity({ location: 'Fairview', markdown: template('Fairview') }, { location: 'Lakeside', markdown: template('Lakeside') })).toBe(1);
  });

  it('scores pages with their own local substance far apart', () => {
    const a = { location: 'Fairview', markdown: `${template('Fairview')}\n\n${local('Fairview')}` };
    const b = { location: 'Lakeside', markdown: template('Lakeside', 'Lakeside homes sit below the dam, where the town water is soft and heaters corrode from the inside. We stock the low-sodium anodes the county inspector asks for.') };

    expect(locationPageSimilarity(a, b)).toBeLessThan(0.7);
  });
});

describe('nearDuplicates', () => {
  it('names each sibling at or over the limit, most similar first, and never the page itself', () => {
    const draft = { pageId: 1, keyword: 'water heater repair fairview', location: 'Fairview, OR', markdown: template('Fairview') };
    const found = nearDuplicates(draft, [
      draft,
      { pageId: 2, keyword: 'water heater repair lakeside', location: 'Lakeside', markdown: template('Lakeside') },
      { pageId: 3, keyword: 'water heater repair millbrook', location: 'Millbrook', markdown: local('Millbrook') },
    ]);

    expect(found).toEqual([{ pageId: 2, keyword: 'water heater repair lakeside', location: 'Lakeside', similarity: 1 }]);
  });
});

describe('the pieces', () => {
  it('reads a draft as the words a reader reads', () => {
    expect(bodyText('## Why us\n\n- **Fast** [book](https://northwind-home.example/book)\n<!-- note -->| a | b |')).toBe('Why us Fast book a b');
  });

  it('masks a place by its full and its short name, whole words only', () => {
    expect(maskPlaces('Fairview, OR homes and Fairview pipes, not Fairviewton', ['Fairview, OR'])).toBe(' placename  homes and  placename  pipes, not Fairviewton');
  });

  it('knows whether a query names the page\'s place', () => {
    expect(queryNamesLocation('water heater repair Fairview OR', 'Fairview, OR')).toBe(true);
    expect(queryNamesLocation('water heater repair near fairview', 'Fairview')).toBe(true);
    expect(queryNamesLocation('water heater repair', 'Fairview')).toBe(false);
    expect(queryNamesLocation('fairviewton water heaters', 'Fairview')).toBe(false);
  });
});
