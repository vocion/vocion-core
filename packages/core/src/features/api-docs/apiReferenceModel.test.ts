import type { ApiReferenceDocument } from './apiReferenceModel';
import { describe, expect, it } from 'vitest';
import { filterOperations, flattenOperations, groupByTag } from './apiReferenceModel';

/**
 * Seventy-odd endpoints is more than anyone scrolls, so the search box is how
 * this page is actually used. What matters is that it narrows the way a reader
 * expects — every word has to land, and a word lands on the method, the path,
 * the summary or the area, not on the paragraphs underneath.
 */

const DOCUMENT: ApiReferenceDocument = {
  info: { title: 'Vocion API', version: '0.1.0', description: '' },
  paths: {
    '/api/v1/reviews': {
      get: {
        operationId: 'get_reviews',
        summary: 'The pending-review queue.',
        description: 'Long prose mentioning budgets.',
        tags: ['reviews'],
        parameters: [{ name: 'kind', in: 'query', description: 'One plane only.' }],
        responses: { 401: { description: 'Unauthorized.' }, 200: { description: 'Success.' } },
      },
      post: {
        'operationId': 'post_reviews',
        'summary': 'Open a review.',
        'tags': ['reviews'],
        'x-required-capability': ['approve'],
        'requestBody': { content: { 'application/json': { schema: { properties: { kind: {}, itemId: {} } } } } },
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

describe('flattenOperations', () => {
  const operations = flattenOperations(DOCUMENT);

  it('gives one row per method, not per path', () => {
    expect(operations.map(operation => `${operation.method} ${operation.path}`)).toEqual([
      'GET /api/v1/reviews',
      'POST /api/v1/reviews',
      'GET /api/v1/budgets',
    ]);
  });

  it('carries the body fields, the capability and the responses a reader needs', () => {
    const post = operations.find(operation => operation.operationId === 'post_reviews');

    expect(post?.takesBody).toBe(true);
    expect(post?.bodyFields).toEqual(['kind', 'itemId']);
    expect(post?.capabilities).toEqual(['approve']);
  });

  it('orders responses by status, whatever order the document listed them in', () => {
    const get = operations.find(operation => operation.operationId === 'get_reviews');

    expect(get?.responses.map(response => response.status)).toEqual(['200', '401']);
  });

  it('knows an endpoint takes no body', () => {
    const get = operations.find(operation => operation.operationId === 'get_reviews');

    expect(get?.takesBody).toBe(false);
  });
});

describe('filterOperations', () => {
  const operations = flattenOperations(DOCUMENT);

  it('returns everything for a blank search', () => {
    expect(filterOperations(operations, '   ')).toHaveLength(3);
  });

  it('needs every word to match, so a method and a path narrow together', () => {
    const found = filterOperations(operations, 'post reviews');

    expect(found.map(operation => operation.operationId)).toEqual(['post_reviews']);
  });

  it('ignores case', () => {
    expect(filterOperations(operations, 'BUDGETS')).toHaveLength(1);
  });

  it('does not match the long description, which would make a common word useless', () => {
    expect(filterOperations(operations, 'budgets').map(operation => operation.operationId)).toEqual(['get_budgets']);
  });
});

describe('groupByTag', () => {
  it('groups by area, sorted, keeping document order inside a group', () => {
    const groups = groupByTag(flattenOperations(DOCUMENT));

    expect(groups.map(group => group.tag)).toEqual(['budgets', 'reviews']);
    expect(groups[1]?.operations.map(operation => operation.method)).toEqual(['GET', 'POST']);
  });
});
