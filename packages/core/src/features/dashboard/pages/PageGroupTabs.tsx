'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * A grouped list page's groups as TABS rather than as sections down the page
 * (`groupsAs: tabs`).
 *
 * A section heading with its rows beneath it makes the page as tall as every
 * group put together, which on a phone means scrolling past everything in
 * progress to reach the one decision you came to make. As tabs each group is
 * a place to stand: the page is the height of one group, and the counts read
 * at a glance without a grid of figures above them repeating what the
 * headings already said.
 *
 * The panels are rendered on the server and handed here as children, so this
 * component holds the selection and nothing else — it never knows what a row
 * is. `groupLabel` is left off the panels: the tab IS the label, and drawing
 * it again inside the panel is the repetition tabs were meant to remove.
 */
export type PageGroup = {
  /** Stable key for the tab, derived from the group's label. */
  key: string;
  /** The tab's name. Short: it is a place to tap, not a sentence. */
  label: string;
  /** How many rows are in the group, including any the panel capped. */
  count: number;
  /** The one thing the group could not draw — decision minutes, what was capped. */
  note?: string | null;
  /** The group's rows, already rendered. */
  children: ReactNode;
};

/**
 * @param root0 - Props.
 * @param root0.groups - The groups, in the order the page sorted them.
 */
export function PageGroupTabs({ groups }: { groups: PageGroup[] }) {
  const first = groups[0]?.key ?? '';
  const [value, setValue] = useState(first);
  // THE TAB IS IN THE URL (Chris, 2026-09-25: "tabs should be hashtags with
  // hash nav so I can back button to it"). A tap pushes `#<key>`, so opening
  // a row and pressing Back lands on the tab you left, and a link can name a
  // tab. The hash is read after mount: the server cannot see it.
  useEffect(() => {
    const read = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      setValue(groups.some(g => g.key === h) ? h : first);
    };
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, [groups, first]);
  if (groups.length === 0) {
    return null;
  }
  const choose = (key: string) => {
    setValue(key);
    if (window.location.hash.slice(1) !== key) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${encodeURIComponent(key)}`);
    }
  };
  return (
    <Tabs value={value} onValueChange={choose} className="mb-8 gap-0">
      <TabsList variant="line" className="mb-1 w-full justify-start overflow-x-auto">
        {groups.map(g => (
          <TabsTrigger key={g.key} value={g.key} className="gap-2" data-testid={`page-tab-${g.key}`}>
            {g.label}
            <span className="font-mono text-xs tabular-nums opacity-60">{g.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      {groups.map(g => (
        <TabsContent key={g.key} value={g.key}>
          {g.note && (
            <p className="mt-3 mb-1 text-xs text-muted-foreground" data-testid={`page-tab-note-${g.key}`}>{g.note}</p>
          )}
          {g.children}
        </TabsContent>
      ))}
    </Tabs>
  );
}
