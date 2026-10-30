import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import { ObjectWorkspace } from './ObjectWorkspace';
import '@/styles/global.css';

describe('a record workspace', () => {
  it('opens the deliverable first and switches supporting context with accessible tabs', async () => {
    await page.viewport(390, 844);
    await render(
      <ObjectWorkspace
        label="Page workspace"
        sections={[
          { id: 'draft', label: 'Draft', content: <p>The current draft</p> },
          { id: 'review', label: 'Review & feedback', content: <p>The editor requested a clearer introduction</p> },
          { id: 'history', label: 'History', content: <p>Version history</p> },
        ]}
        aside={<p>Author: Mira</p>}
      />,
    );

    await expect.element(page.getByRole('tabpanel')).toHaveTextContent('The current draft');

    await page.getByRole('tab', { name: 'Review & feedback' }).click();

    await expect.element(page.getByRole('tabpanel')).toHaveTextContent('The editor requested a clearer introduction');

    await page.getByRole('tab', { name: 'History' }).click();

    await expect.element(page.getByRole('tabpanel')).toHaveTextContent('Version history');
    await expect.element(page.getByText('Author: Mira')).toBeVisible();
  });
});
