/**
 * The `rest` source config: the contract in `docs/guides/rest.md` parses
 * whole, every way of getting it wrong is refused at apply with the entry
 * named, and the stored row's config reads back for the tool builder.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { endpointDescription, restConfigOf, restConfigSchema, restToolName, toolPrefixFor } from './spec';

/** The worked example from the guide, as YAML would load it. */
export const EXAMPLE_CONFIG = {
  toolPrefix: 'delivery',
  healthPath: '/api/users/me',
  tools: [
    {
      name: 'list_projects',
      description: 'List projects visible to the account. Filter by status.',
      method: 'GET',
      path: '/api/projects',
      input: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['active', 'archived'], description: 'Project status' },
          search: { type: 'string', description: 'Substring of the project name' },
        },
        required: [],
      },
      query: {
        'filters[status][$eq]': '{status}',
        'filters[name][$containsi]': '{search}',
        'pagination[pageSize]': '100',
      },
      response: { pick: 'data', maxChars: 40000 },
    },
    {
      name: 'get_project',
      method: 'GET',
      path: '/api/projects/{documentId}',
      input: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'] },
    },
  ],
  actions: [
    {
      name: 'update_milestone',
      description: 'Change a milestone\'s name or due date.',
      method: 'PUT',
      path: '/api/milestones/{documentId}',
      input: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          name: { type: 'string' },
          dueDate: { type: 'string', format: 'date' },
        },
        required: ['documentId'],
      },
      body: { data: { name: '{name}', dueDate: '{dueDate}' } },
      reversible: false,
      review: {
        title: 'Update milestone {documentId}',
        fields: [
          { label: 'Name', value: '{name}' },
          { label: 'Due', value: '{dueDate}' },
        ],
      },
    },
  ],
};

function problemsOf(config: unknown): string[] {
  const parsed = restConfigSchema.safeParse(config);
  return parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
}

describe('restConfigSchema', () => {
  it('accepts the guide\'s example and fills the defaults', () => {
    const parsed = restConfigSchema.parse(EXAMPLE_CONFIG);

    expect(parsed.tools.map(t => t.name)).toEqual(['list_projects', 'get_project']);
    expect(parsed.tools[1]!.query).toEqual({});
    expect(parsed.tools[1]!.response).toEqual({ maxChars: 40000 });
    expect(parsed.actions[0]!.reversible).toBe(false);
    expect(parsed.actions[0]!.review?.fields).toHaveLength(2);
  });

  it('accepts an empty config — a source added by hand before the manifest declares anything', () => {
    expect(restConfigSchema.parse({})).toEqual({ healthPath: '/', tools: [], actions: [] });
  });

  it('refuses a mistyped key on a tool or an action, naming it', () => {
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a', querry: {} }] })).toEqual([expect.stringMatching(/tools\.0: .*querry/)]);
    expect(problemsOf({ actions: [{ name: 'a', method: 'POST', path: '/a', reviw: {} }] })).toEqual([expect.stringMatching(/actions\.0: .*reviw/)]);
  });

  it('refuses an input schema outside the subset, with the property named', () => {
    const problems = problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a', input: { type: 'object', properties: { owner: { type: 'object' } } } }] });

    expect(problems).toEqual([expect.stringContaining('input.owner: nested objects are not supported')]);
  });

  it('refuses a placeholder that names no input property, in a path, a query, a body or a review hint', () => {
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a/{id}', input: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, query: { q: '{serch}' } }] }))
      .toEqual([expect.stringContaining('a: query uses {serch}, which is not one of its input properties')]);
    expect(problemsOf({ actions: [{ name: 'a', method: 'POST', path: '/a', body: { data: { name: '{nam}' } } }] }))
      .toEqual([expect.stringContaining('a: body uses {nam}')]);
    expect(problemsOf({ actions: [{ name: 'a', method: 'POST', path: '/a', review: { title: 'Do {thing}' } }] }))
      .toEqual([expect.stringContaining('a: review uses {thing}')]);
  });

  it('accepts built-in date placeholders anywhere, and refuses a {$…} it does not know, naming where', () => {
    expect(problemsOf({
      tools: [{ name: 'due', method: 'GET', path: '/api/reports/{$today}', query: { 'filters[dueDate][$gte]': '{$today-7d}', 'until': '{$monthEnd}' } }],
      actions: [{ name: 'plan', method: 'POST', path: '/api/plans', body: { data: { from: '{$weekStart}', to: '{$today+30d}' } }, review: { title: 'Plan from {$weekStart}' } }],
    })).toEqual([]);
    expect(problemsOf({ tools: [{ name: 'due', method: 'GET', path: '/a', query: { since: '{$yesterday}' } }] }))
      .toEqual([expect.stringContaining('due: query — {$yesterday} is not a built-in placeholder')]);
    expect(problemsOf({ actions: [{ name: 'plan', method: 'POST', path: '/a', body: { at: '{$now}' } }] }))
      .toEqual([expect.stringContaining('plan: body — {$now} is not a built-in placeholder')]);
  });

  it('accepts query on an action as well as a tool', () => {
    const parsed = restConfigSchema.parse({ actions: [{ name: 'toggle_automation', method: 'POST', path: '/api/automations/{id}/toggle', input: { type: 'object', properties: { id: { type: 'string' }, dryRun: { type: 'boolean' } }, required: ['id'] }, query: { dryRun: '{dryRun}' } }] });

    expect(parsed.actions[0]!.query).toEqual({ dryRun: '{dryRun}' });
  });

  it('refuses a path parameter that is not required, because the endpoint cannot be called without it', () => {
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a/{id}', input: { type: 'object', properties: { id: { type: 'string' } } } }] }))
      .toEqual([expect.stringContaining('path parameter {id} must be listed under input.required')]);
  });

  it('refuses two entries with one name, the reserved list_actions name, a bad method and a path with no slash', () => {
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a' }, { name: 'a', method: 'GET', path: '/b' }] })).toEqual([expect.stringContaining('two tools are named "a"')]);
    expect(problemsOf({ tools: [{ name: 'list_actions', method: 'GET', path: '/a' }] })).toEqual([expect.stringContaining('reserved')]);
    expect(problemsOf({ tools: [{ name: 'a', method: 'FETCH', path: '/a' }] })).toHaveLength(1);
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: 'a' }] })).toEqual(['tools.0.path: must start with /']);
    expect(problemsOf({ tools: [{ name: 'List Projects', method: 'GET', path: '/a' }] })).toEqual([expect.stringContaining('snake_case')]);
  });

  it('refuses a response.select entry that is not a string, or steps outside letters, digits, _, -, . and []', () => {
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a', response: { select: [42] } }] })).toEqual([expect.stringContaining('tools.0.response.select.0: Invalid input: expected string, received number')]);
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a', response: { select: ['data[].*'] } }] })).toEqual([expect.stringContaining('may only use letters, digits, _, -, . and []')]);
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a', response: { select: ['data[0].id'] } }] })).toEqual([expect.stringContaining('not a key optionally followed by []')]);
    expect(problemsOf({ tools: [{ name: 'a', method: 'GET', path: '/a', response: { select: 'data[].id' } }] })).toHaveLength(1);
    expect(problemsOf({ actions: [{ name: 'a', method: 'POST', path: '/a', response: { select: ['data.id', 'meta.total'] } }] })).toEqual([]);
  });

  it('prints as one line per fault through z.prettifyError, which is what the apply reports', () => {
    const parsed = restConfigSchema.safeParse({ tools: [{ name: 'a', method: 'GET', path: 'a', query: { q: '{x}' } }] });

    expect(parsed.success).toBe(false);
    expect(z.prettifyError(parsed.error!)).toContain('must start with /');
    expect(z.prettifyError(parsed.error!)).toContain('query uses {x}');
  });
});

describe('naming', () => {
  it('prefixes tools with the declared prefix, else the slug with dashes turned to underscores', () => {
    expect(toolPrefixFor('billing-api', {})).toBe('billing_api');
    expect(toolPrefixFor('billing-api', { toolPrefix: 'Billing' })).toBe('billing');
    expect(restToolName('billing_api', 'list_invoices')).toBe('billing_api_list_invoices');
  });

  it('describes an endpoint that declared no description as its method and path', () => {
    expect(endpointDescription({ name: 'a', method: 'GET', path: '/a', input: { type: 'object' }, query: {}, response: { maxChars: 1 } })).toBe('GET /a');
  });
});

describe('restConfigOf', () => {
  it('reads a stored row, ignoring the writer\'s reserved keys, and returns null for one that does not parse', () => {
    const stored = { ...EXAMPLE_CONFIG, _connector: 'rest', _name: 'Acme Delivery API', _manifestDir: '/tmp/ws' };

    expect(restConfigOf(stored)?.tools).toHaveLength(2);
    expect(restConfigOf({ _connector: 'rest', tools: 'nope' })).toBeNull();
    expect(restConfigOf(null)).toEqual({ healthPath: '/', tools: [], actions: [] });
  });
});
