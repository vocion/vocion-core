/**
 * A TICKET-SIZED TITLE (Chris, 2026-10-03: "The title is too long and verbose
 * … we need a better ticket-sized name for what the feature is; not a full
 * request or spec in the title"). The request type says its title is at most
 * 60 characters and where a longer one's words go (`x-agent-file.longTitleTo:
 * body`); the filing tool tells the model the limit, and a filer that still
 * hands over the whole ask is not refused — the words are kept as the ask
 * and a model names the request. The model is scripted. Fictional fixture
 * (Northwind).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadWorkspace } from '@/libs/workspace/loader';

vi.mock('@/libs/DB');

const { filingInputOf, filingSchema, filingTypeOf, nameLongTitle } = await import('./fileRecord');

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

function storedRequestType(): { slug: string; label: string; description?: string; schema: Record<string, unknown> } {
  const dir = mkdtempSync(join(tmpdir(), 'file-record-naming-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\nplugins: [software-factory]\n');
  const ot = loadWorkspace(dir).objectTypes.find(t => t.slug === 'request')!;
  return { slug: ot.slug, label: ot.label, description: ot.description, schema: { ...(ot.schema ?? {}), 'x-gates': ot.gates ?? [] } };
}

const ASK = 'On the Northwind library list, let me sort the documents by name, upload date or last opened, newest first by default, and remember my choice next time I open the library';

describe('the request\'s title, ticket-sized', () => {
  const spec = filingTypeOf(storedRequestType(), { product: ['northwind'] })!;

  it('reads the limit and where the long words go from the type', () => {
    expect(spec.titleMax).toBe(60);
    expect(spec.longTitleTo).toBe('body');
  });

  it('tells the model the limit and that the whole ask goes in the body', () => {
    const schema = toJsonSchema(filingSchema(spec) as never) as { properties: Record<string, { description?: string; maxLength?: number }> };

    expect(schema.properties.title!.description).toContain('ticket-sized name');
    expect(schema.properties.title!.description).toContain('At most 60 characters. The whole ask goes in `body`, never in the title.');
    // Told, not refused: a longer title is named, not bounced back to the model.
    expect(schema.properties.title!.maxLength).toBe(500);
  });

  it('names a long title with the model, keeps the words as the ask, and dedups on the name', async () => {
    const read = vi.fn(async () => 'Sort the library by name, date or last opened');
    const filed = await nameLongTitle('org_northwind', spec, filingInputOf(spec, { title: ASK, product: 'northwind' }), read);

    expect(read).toHaveBeenCalledWith({ orgId: 'org_northwind', text: ASK, kind: 'request' });
    expect(filed).toMatchObject({ title: 'Sort the library by name, date or last opened', named: true });
    expect(filed.fields).toMatchObject({ title: 'Sort the library by name, date or last opened', body: ASK, product: 'northwind' });
  });

  it('never replaces the asker\'s own words already in the body', async () => {
    const body = 'Can I sort the library? Newest first please.';
    const filed = await nameLongTitle('org_northwind', spec, filingInputOf(spec, { title: ASK, product: 'northwind', body }), async () => 'Sort the library');

    expect(filed.fields.body).toBe(body);
    expect(filed.title).toBe('Sort the library');
  });

  it('leaves a short title alone and asks no model', async () => {
    const read = vi.fn(async () => 'never');
    const filed = await nameLongTitle('org_northwind', spec, filingInputOf(spec, { title: 'Sort the library', product: 'northwind' }), read);

    expect(read).not.toHaveBeenCalled();
    expect(filed).toMatchObject({ title: 'Sort the library', named: false });
  });

  it('files the title as it came when the model cannot name it — never a cut title', async () => {
    const filed = await nameLongTitle('org_northwind', spec, filingInputOf(spec, { title: ASK, product: 'northwind' }), async () => null);

    expect(filed).toMatchObject({ title: ASK, named: false });
    expect(filed.fields.body).toBeUndefined();
  });
});
