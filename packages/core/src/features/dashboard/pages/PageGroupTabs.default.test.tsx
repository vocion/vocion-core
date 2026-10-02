import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { PageGroupTabs } from './PageGroupTabs';
import '@/styles/global.css';

const group = (key: string, label: string, count: number) => ({ key, label, count, note: null, children: <p>{`${label} rows`}</p> });

describe('tabs open on the first tab with anything in it', () => {
  it('opens Proposed when In progress is empty', async () => {
    const screen = await render(<PageGroupTabs groups={[group('progress', 'In progress', 0), group('proposed', 'Proposed', 8), group('done', 'Done', 30)]} />);

    await expect.element(screen.getByText('Proposed rows')).toBeVisible();
  });

  it('opens the first tab when it has rows, and the first when every tab is empty', async () => {
    const busy = await render(<PageGroupTabs groups={[group('progress', 'In progress', 2), group('proposed', 'Proposed', 8)]} />);

    await expect.element(busy.getByText('In progress rows')).toBeVisible();

    busy.unmount();
    const empty = await render(<PageGroupTabs groups={[group('progress', 'In progress', 0), group('proposed', 'Proposed', 0)]} />);

    await expect.element(empty.getByText('In progress rows')).toBeVisible();
  });
});
