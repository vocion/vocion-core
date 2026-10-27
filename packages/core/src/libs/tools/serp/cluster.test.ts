import { describe, expect, it } from 'vitest';
import { clusterKeywords, pageKey } from './cluster';

const url = (path: string) => `https://${path}`;

describe('clusterKeywords', () => {
  const fairview = ['yelp.com/search?find_loc=fairview', 'northwind-home.example/fairview/water-heater-repair', 'angi.com/fairview/water-heaters', 'lakeside-plumbing.example/water-heaters', 'contoso-supply.example/heaters'].map(url);

  it('puts keywords whose top tens share three or more URLs on one page', () => {
    const clusters = clusterKeywords([
      { keyword: 'water heater repair fairview', urls: fairview },
      { keyword: 'water heater repair near fairview', urls: [...fairview.slice(1, 4), url('acme.example/a')] },
      { keyword: 'tankless water heater fairview', urls: [fairview[1]!, url('acme.example/tankless'), url('contoso-supply.example/tankless')] },
    ]);

    expect(clusters.map(c => [c.head, c.members.map(m => m.keyword)])).toEqual([
      ['water heater repair fairview', ['water heater repair fairview', 'water heater repair near fairview']],
      ['tankless water heater fairview', ['tankless water heater fairview']],
    ]);
    expect(clusters[0]!.members[1]).toMatchObject({ sharedWithHead: 3 });
  });

  it('compares with the head, so a chain does not collapse into one page', () => {
    const a = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(p => url(`site.example/${p}`));
    const b = ['a4', 'a5', 'a6', 'b1', 'b2', 'b3'].map(p => url(`site.example/${p}`));
    const c = ['b1', 'b2', 'b3', 'c1'].map(p => url(`site.example/${p}`));

    expect(clusterKeywords([{ keyword: 'a', urls: a }, { keyword: 'b', urls: b }, { keyword: 'c', urls: c }]).map(x => x.members.map(m => m.keyword))).toEqual([['a', 'b'], ['c']]);
  });

  it('treats the same page written two ways as one URL, and a repeated keyword once', () => {
    expect(pageKey('https://www.Northwind-Home.example/fairview/?utm_source=x#top')).toBe('northwind-home.example/fairview');

    const clusters = clusterKeywords([
      { keyword: 'Water heater repair', urls: fairview },
      { keyword: 'water  heater repair', urls: fairview },
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members).toHaveLength(1);
  });
});
