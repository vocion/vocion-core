import type { ApiReferenceDocument } from './apiReferenceModel';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';
import { ApiReference } from './ApiReference';

/**
 * This page is read by someone wiring an outside system up to Vocion, so what
 * it has to get right is the contract: find the endpoint, see what it takes,
 * see what comes back, and copy a call that works. These pin that path —
 * searching narrows, opening an endpoint shows its parameters and the
 * capability it needs, and the example call carries the bearer header a real
 * request needs.
 */

const DOCUMENT: ApiReferenceDocument = {
  info: { title: 'Vocion API', version: '0.1.0', description: '' },
  paths: {
    '/api/v1/reviews': {
      get: {
        operationId: 'get_reviews',
        summary: 'The pending-review queue.',
        description: 'Paused workflow runs and pending proposals.',
        tags: ['reviews'],
        parameters: [{ name: 'kind', in: 'query', description: 'One plane only.' }],
        responses: {
          200: { description: 'Success.' },
          403: { description: 'The caller is authenticated but not allowed to do this.' },
        },
      },
      post: {
        'operationId': 'post_reviews',
        'summary': 'Open a review.',
        'tags': ['reviews'],
        'x-required-capability': ['approve'],
        'requestBody': { content: { 'application/json': { schema: { properties: { itemId: {} } } } } },
        'responses': { 200: { description: 'Success.' } },
      },
    },
    '/api/v1/budgets': {
      get: {
        operationId: 'get_budgets',
        summary: 'Agent budgets.',
        tags: ['budgets'],
        responses: { 200: { description: 'Success.' } },
      },
    },
  },
};

describe('ApiReference', () => {
  it('lists every endpoint in the document, grouped by area', async () => {
    render(<ApiReference document={DOCUMENT} origin="https://agents.example.com" />);

    await expect.element(page.getByTestId('endpoint-count')).toHaveTextContent('3 endpoints');
    await expect.element(page.getByText('/api/v1/budgets', { exact: true })).toBeVisible();
    await expect.element(page.getByText('The pending-review queue.')).toBeVisible();
  });

  it('narrows to the endpoints matching every word typed', async () => {
    render(<ApiReference document={DOCUMENT} origin="https://agents.example.com" />);

    await userEvent.fill(page.getByLabelText('Search endpoints'), 'post reviews');

    await expect.element(page.getByTestId('endpoint-count')).toHaveTextContent('1 of 3 endpoints');
    await expect.element(page.getByText('Open a review.')).toBeVisible();
    expect(await page.getByText('Agent budgets.').elements()).toHaveLength(0);
  });

  it('says so rather than showing an empty page when nothing matches', async () => {
    render(<ApiReference document={DOCUMENT} origin="https://agents.example.com" />);

    await userEvent.fill(page.getByLabelText('Search endpoints'), 'sftp');

    await expect.element(page.getByText('Nothing matches', { exact: false })).toBeVisible();
  });

  it('shows an endpoint its parameters and the statuses it answers with', async () => {
    render(<ApiReference document={DOCUMENT} origin="https://agents.example.com" />);

    await userEvent.click(page.getByText('The pending-review queue.'));

    await expect.element(page.getByText('One plane only.')).toBeVisible();
    await expect.element(page.getByText('The caller is authenticated but not allowed to do this.')).toBeVisible();
  });

  it('names the capability a restricted endpoint needs, so a 403 is explainable', async () => {
    render(<ApiReference document={DOCUMENT} origin="https://agents.example.com" />);

    await userEvent.click(page.getByText('Open a review.'));

    await expect.element(page.getByTestId('capabilities-post_reviews')).toHaveTextContent('Requires capability: approve');
  });

  it('offers a call that carries the bearer token and the real origin', async () => {
    render(<ApiReference document={DOCUMENT} origin="https://agents.example.com" />);

    await userEvent.click(page.getByText('Open a review.'));

    const example = page.getByTestId('example-post_reviews');

    await expect.element(example).toHaveTextContent('curl -X POST \'https://agents.example.com/api/v1/reviews\'');
    await expect.element(example).toHaveTextContent('Authorization: Bearer vcn_live_');
  });
});
