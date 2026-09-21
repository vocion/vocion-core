import type { PageRow } from './pages';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { declaredRecordFields, hasInspectionImage, isDiscoveryRecord, recordSections } from './records';

/**
 * A record read from its own type — the bug half of #522. The record page
 * rendered one customer's discovery call for every object of every type;
 * these are the rules that make it render what the type actually declares.
 *
 * Exercised through the REAL shipped types (templates/plugins/software-factory)
 * rather than through invented ones, so a type that stops declaring its
 * fields fails here.
 */

function shippedSchema(slug: string): unknown {
  const file = join(process.cwd(), 'templates/plugins/software-factory/objects', slug, 'type.yaml');
  return (parseYaml(readFileSync(file, 'utf8')) as { schema: unknown }).schema;
}

function record(meta: Record<string, unknown>, over: Partial<PageRow> = {}): PageRow {
  return { id: 83, title: 'Stop the sign-in loop on Safari', status: 'accepted', createdAt: new Date('2026-09-12T10:00:00Z'), meta, ...over };
}

const TASK = {
  repoSlug: 'squatch-core',
  productSlug: 'send',
  objective: 'Sessions dropped on Safari because the cookie was written without SameSite=None; set it and keep the loop closed.',
  requestId: 41,
  acceptanceContract: ['A Safari session survives a reload', 'The e2e sign-in spec passes'],
  requiredChecks: ['npm run lint', 'npm run test'],
  riskClass: 'auth',
  sizeClass: 'patch',
  attempt: 2,
  estimateCents: 400,
  actualCents: 512,
  prUrl: 'https://github.com/squatch/squatch-core/pull/318',
  commitSha: 'a1b2c3d',
  summary: 'Set SameSite=None; Secure on the session cookie and added a regression spec.',
  costUpdatedAt: '2026-09-12T11:00:00Z',
};

describe('an engineering task, read from the engineering_task type', () => {
  const fields = declaredRecordFields(shippedSchema('engineering_task'));

  it('declares its fields with a label, a format and, where it has them, tones', () => {
    const by = (k: string) => fields.find(f => f.key === k);

    expect(by('estimateCents')).toMatchObject({ label: 'Estimated', format: 'money', role: 'fact', group: 'Cost' });
    expect(by('riskClass')).toMatchObject({ label: 'Risk', format: 'badge', role: 'fact' });
    expect(by('riskClass')?.tones?.auth).toBe('bad');
    expect(by('requestId')).toMatchObject({ label: 'Asked by', format: 'link', to: 'request', role: 'link' });
    expect(by('prUrl')).toMatchObject({ label: 'Pull request', format: 'link', role: 'link' });
    expect(by('objective')).toMatchObject({ role: 'prose' });
    expect(by('acceptanceContract')).toMatchObject({ format: 'steps', role: 'prose' });
    expect(by('costUpdatedAt')).toMatchObject({ role: 'timestamp' });
    // The pre-registry shape is declared so a write validates, and hidden
    // so a record does not read two repository fields.
    expect(by('repo')).toBeUndefined();
  });

  it('renders the contract, the checks, the pull request and the cost — what the record actually carries', () => {
    const s = recordSections(record(TASK), fields);

    expect(s.prose.map(f => f.label)).toEqual(['Objective', 'Acceptance contract', 'Required checks', 'What the worker said it did']);
    expect(s.facts.map(g => g.group)).toEqual(['Contract', 'Cost', 'The change']);
    expect(s.facts.find(g => g.group === 'Cost')?.fields.map(f => f.label)).toEqual(['Estimated', 'Actual']);
    expect(s.links.map(f => f.label)).toEqual(['Repository', 'Product', 'Asked by', 'Pull request']);
    expect(s.timestamps.map(f => f.label)).toEqual(['Cost as of']);
  });

  it('leaves out every declared field the record has no value for', () => {
    const shown = recordSections(record(TASK), fields);
    const all = [...shown.prose, ...shown.facts.flatMap(g => g.fields), ...shown.links, ...shown.timestamps].map(f => f.key);

    expect(all).not.toContain('branch');
    expect(all).not.toContain('knownFailures');
    expect(all).not.toContain('dependencies');
    expect(all.length).toBeLessThan(fields.length);
  });

  it('puts a value the record carries and the type never declared in Other fields, so nothing is invisible', () => {
    const s = recordSections(record({ ...TASK, workerRunId: 907, scratch: '' }), fields);

    expect(s.otherKeys).toEqual(['workerRunId']);
  });

  it('is not a discovery call and not an inspection, so neither block is its business', () => {
    expect(isDiscoveryRecord(TASK)).toBe(false);
    expect(hasInspectionImage(TASK)).toBe(false);
  });
});

describe('a request and a release, read from their own types', () => {
  it('reads a request: what they asked in their own words, the triage facts, the tasks it became', () => {
    const fields = declaredRecordFields(shippedSchema('request'));
    const s = recordSections(record({
      kind: 'bug',
      channel: 'store_review',
      body: 'Signing in on my iPhone loops forever.',
      severity: 'p1',
      state: 'shipped',
      taskIds: [83],
      releaseId: 12,
      askedAt: '2026-09-10T08:00:00Z',
      actualCents: 512,
    }), fields);

    expect(s.prose.map(f => f.label)).toEqual(['In their words']);
    expect(s.facts.find(g => g.group === 'Triage')?.fields.map(f => f.label)).toEqual(['Kind', 'Severity', 'State']);
    expect(s.links.map(f => [f.label, f.to])).toEqual([['Tasks', 'engineering_task'], ['Shipped in', 'release']]);
    expect(s.timestamps.map(f => f.label)).toEqual(['Asked']);
  });

  it('reads a release: the notes, the health after, the tasks and requests it carried', () => {
    const fields = declaredRecordFields(shippedSchema('release'));
    const s = recordSections(record({
      product: 'send',
      version: '1.4.2',
      releasedAt: '2026-09-12T18:00:00Z',
      healthAfter: 'ok',
      notes: '- Safari sign-in no longer loops',
      taskIds: [83],
      requestIds: [41],
    }), fields);

    expect(s.prose.map(f => f.label)).toEqual(['Release notes']);
    expect(s.facts.find(g => g.group === 'After the deploy')?.fields.map(f => f.label)).toEqual(['Health after']);
    expect(s.links.map(f => f.label)).toEqual(['Product', 'Tasks', 'Requests it closes']);
    expect(s.timestamps.map(f => f.label)).toEqual(['Released']);
  });
});

describe('a type that annotates nothing', () => {
  it('still reads: a label from the key, a date from the JSON format, a badge from an enum, a list as steps', () => {
    const fields = declaredRecordFields({
      type: 'object',
      properties: {
        prospect_name: { type: 'string' },
        scheduled_at: { type: 'string', format: 'date-time' },
        stage: { type: 'string', enum: ['won', 'lost'] },
        next_steps: { type: 'array', items: { type: 'string' } },
        revenueCents: { type: 'integer' },
        docsUrl: { type: 'string' },
      },
    });

    expect(fields.map(f => [f.key, f.label, f.format, f.role])).toEqual([
      ['prospect_name', 'Prospect name', 'text', 'fact'],
      ['scheduled_at', 'Scheduled at', 'date', 'timestamp'],
      ['stage', 'Stage', 'badge', 'fact'],
      ['next_steps', 'Next steps', 'steps', 'fact'],
      ['revenueCents', 'Revenue cents', 'money', 'fact'],
      ['docsUrl', 'Docs url', 'link', 'link'],
    ]);
  });

  it('has no fields at all when the type never declared a schema, and says so by showing everything as Other', () => {
    expect(declaredRecordFields(null)).toEqual([]);
    expect(recordSections(record({ a: 1, b: 'two' }), []).otherKeys).toEqual(['a', 'b']);
  });
});

describe('the discovery and vision blocks', () => {
  it('are for a record that carries their fields, and nothing else', () => {
    expect(isDiscoveryRecord({ key_topics: ['pricing'] })).toBe(true);
    expect(isDiscoveryRecord({ topics: ['pricing'] })).toBe(true);
    expect(isDiscoveryRecord({ next_steps: ['send the quote'] })).toBe(true);
    expect(isDiscoveryRecord({ key_topics: [], next_steps: [] })).toBe(false);
    expect(isDiscoveryRecord({ objective: 'ship it' })).toBe(false);

    expect(hasInspectionImage({ image_url: 'https://s3/x.png' })).toBe(true);
    expect(hasInspectionImage({ image_url: '' })).toBe(false);
    expect(hasInspectionImage({})).toBe(false);
  });
});
