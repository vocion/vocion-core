import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ChipRow } from './ChipRow';
import { FilterBar } from './FilterBar';

/**
 * One field that filters AND searches.
 *
 * The contract worth protecting: a person types without deciding in advance
 * whether they meant a filter or a search, and gets both. Everything else here
 * is the tag-input behaviour people already expect.
 */

const OPTIONS = [
  { value: 'kind:proposal', label: 'Proposals', count: 136, group: 'Kind' },
  { value: 'type:hubspot.update', label: 'HubSpot update', count: 104, group: 'Type' },
  { value: 'type:gmail.send', label: 'Gmail send', count: 6, group: 'Type' },
  { value: 'agent:revenue-lead', label: 'revenue-lead', count: 131, group: 'Agent' },
];

function Harness({ onQuery }: { onQuery?: (q: string) => void } = {}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  return (
    <FilterBar
      label="Filter the review queue"
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        onQuery?.(q);
      }}
      options={OPTIONS}
      selected={selected}
      onSelectedChange={setSelected}
      searching="deals, contacts and agents"
      advancedCount={selected.length}
      advanced={(
        <ChipRow
          label="All filters"
          chips={OPTIONS.map(o => ({
            key: o.value,
            label: o.label,
            count: o.count,
            active: selected.includes(o.value),
            onToggle: () => setSelected(s => (s.includes(o.value) ? s.filter(v => v !== o.value) : [...s, o.value])),
          }))}
        />
      )}
    />
  );
}

describe('one field for filtering and searching', () => {
  it('searches the list with the same letters that narrow the filters', async () => {
    const typed: string[] = [];
    await render(<Harness onQuery={q => typed.push(q)} />);

    await userEvent.fill(page.getByRole('combobox'), 'hub');

    // The text reached the list's search…
    expect(typed.at(-1)).toBe('hub');
    // …and narrowed the options at the same time.
    await expect.element(page.getByRole('option', { name: /HubSpot update/ })).toBeVisible();
    expect(page.getByRole('option', { name: /Gmail send/ }).elements()).toHaveLength(0);
  });

  it('says that the text is also searching, so an empty match list is not a dead end', async () => {
    await render(<Harness />);

    await userEvent.fill(page.getByRole('combobox'), 'northwind');

    await expect.element(page.getByText(/Searching deals, contacts and agents/)).toBeVisible();
  });

  it('spans every dimension at once, under its own heading', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('combobox'));

    await expect.element(page.getByText('Kind', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Type', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Agent', { exact: true })).toBeVisible();
  });

  it('keeps a chosen filter as a token you can take back off', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('combobox'));
    await userEvent.click(page.getByRole('option', { name: /HubSpot update/ }).getByRole('button'));

    await expect.element(page.getByRole('button', { name: 'Remove HubSpot update' })).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Remove HubSpot update' }));

    expect(page.getByRole('button', { name: 'Remove HubSpot update' }).elements()).toHaveLength(0);
  });

  it('counts the active filters on the funnel while the panel is shut', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('combobox'));
    await userEvent.click(page.getByRole('option', { name: /HubSpot update/ }).getByRole('button'));

    await expect.element(page.getByTestId('filter-advanced')).toHaveTextContent('1');
  });

  it('opens the full grid behind the funnel, and it starts shut', async () => {
    await render(<Harness />);

    expect(await page.getByTestId('filter-advanced').element().getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(page.getByTestId('filter-advanced'));

    expect(await page.getByTestId('filter-advanced').element().getAttribute('aria-expanded')).toBe('true');
  });
});
