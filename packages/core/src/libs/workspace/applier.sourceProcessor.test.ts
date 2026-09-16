/**
 * A source's `processor:` block, from manifest to stored `config_json`.
 *
 * Everything checked at apply time here would otherwise fail at RUN time, once
 * per document, for as long as nobody looked: an unknown processor slug, a
 * config the processor would refuse, a learning step that does not exist
 * (`getLearnings` throws on one), an agent slug that does not (which degrades
 * the learning loop silently, the worst kind). Failing one source's apply with
 * a message naming the mistake is the whole point.
 *
 * The typo case is the one that needs the manifest schema rather than the
 * applier: a plain `z.object` strips what it does not know, so a mistyped key
 * would be dropped without a word.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, knowledgeSourceSchema, memoryNamespaceSchema, memorySchema, workspaceVersionSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { eq } = await import('drizzle-orm');

const ORG = 'org_source_processor';
const AGENT = 'event-ingestion-lead';
const STEP = 'event-extraction';

const dirs: string[] = [];

/**
 * A config the candidate-extractor accepts, as a manifest would write it.
 * @param overrides - Fields to add or replace for one test.
 */
function extractorConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    objectType: 'event-candidate',
    agentSlug: AGENT,
    dedupOn: ['title', 'startDate', 'venueName'],
    titleFrom: 'title',
    promptFragment: 'Only list events open to the public.',
    ...overrides,
  };
}

/**
 * A one-source workspace, optionally with the agent and learning step a
 * processor config may name.
 * @param opts - What the fixture declares.
 * @param opts.processorBlock - The `processor:` block as YAML-ready JSON, or undefined for none.
 * @param opts.withAgent - Whether to declare the agent the config names.
 * @param opts.withStep - Whether to declare the learning step the config names.
 */
function writeFixture(opts: {
  processorBlock?: Record<string, unknown>;
  withAgent?: boolean;
  withStep?: boolean;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-source-processor-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: source-processor\n`);
  mkdirSync(join(dir, 'sources'));
  const processorLine = opts.processorBlock ? `processor: ${JSON.stringify(opts.processorBlock)}\n` : '';
  writeFileSync(
    join(dir, 'sources', 'listings.yaml'),
    `slug: listings\nname: Listings\nkind: web\nconfig: {"urls": ["https://example.test/listings"]}\n${processorLine}`,
  );
  if (opts.withAgent) {
    mkdirSync(join(dir, 'agents'));
    writeFileSync(join(dir, 'agents', `${AGENT}.yaml`), `slug: ${AGENT}\nname: Ingestion Lead\nsystemPrompt: Be helpful.\n`);
  }
  if (opts.withStep) {
    mkdirSync(join(dir, 'learnings'));
    writeFileSync(join(dir, 'learnings', `${STEP}.yaml`), `name: ${STEP}\ntitle: Event extraction\ndescription: How to read a listing.\n`);
  }
  return dir;
}

/**
 * Apply such a workspace.
 * @param opts - Same options as `writeFixture`.
 */
async function apply(opts: Parameters<typeof writeFixture>[0]) {
  return applyWorkspace(loadWorkspace(writeFixture(opts)), { orgId: ORG });
}

/** The stored source row's config blob. */
async function storedConfig(): Promise<Record<string, unknown> | undefined> {
  const [row] = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.orgId, ORG));
  return row?.configJson as Record<string, unknown> | undefined;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  warnSpy.mockRestore();
  await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, ORG));
  await db.delete(memorySchema).where(eq(memorySchema.orgId, ORG));
  await db.delete(memoryNamespaceSchema).where(eq(memoryNamespaceSchema.orgId, ORG));
  await db.delete(agentSchema).where(eq(agentSchema.orgId, ORG));
  await db.delete(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));
});

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('a source declaring a processor', () => {
  it('stamps the authored config under `_processor`, beside `_connector`', async () => {
    const result = await apply({
      processorBlock: { slug: 'candidate-extractor', config: extractorConfig({ learningSteps: [STEP] }) },
      withAgent: true,
      withStep: true,
    });

    expect(result.errors).toEqual([]);

    const config = await storedConfig();

    expect(config?._connector).toBe('web');
    // The AUTHORED config, not the parsed one: storing defaults would bake
    // today's values into every row and re-sync them all when one changes.
    expect(config?._processor).toEqual({
      slug: 'candidate-extractor',
      config: extractorConfig({ learningSteps: [STEP] }),
    });
  });

  it('leaves `_processor` out entirely when no processor is declared', async () => {
    const result = await apply({});

    expect(result.errors).toEqual([]);
    expect(await storedConfig()).not.toHaveProperty('_processor');
  });

  it('reports a mistyped key in the processor block instead of dropping it', () => {
    // `configg:` next to `slug:` reaches the loader, which is where the
    // strictness has to live, the applier never sees a stripped key.
    const dir = writeFixture({ processorBlock: { slug: 'candidate-extractor', configg: extractorConfig() } });

    expect(() => loadWorkspace(dir)).toThrow(/configg/);
  });

  it('fails that source when the processor slug is not registered', async () => {
    const result = await apply({ processorBlock: { slug: 'candidate-extractorr', config: extractorConfig() }, withAgent: true });

    expect(result.errors).toContainEqual(expect.objectContaining({
      resource: 'source',
      slug: 'listings',
      message: expect.stringContaining('unknown processor'),
    }));
    expect(await storedConfig()).toBeUndefined();
  });

  it('fails that source when the processor config would not parse', async () => {
    const result = await apply({
      processorBlock: { slug: 'candidate-extractor', config: extractorConfig({ maxRecordsPerDoc: 10 }) },
      withAgent: true,
    });

    expect(result.errors).toContainEqual(expect.objectContaining({ resource: 'source', slug: 'listings' }));
    expect(await storedConfig()).toBeUndefined();
  });

  it('fails that source when it names a learning step the org does not have', async () => {
    const result = await apply({
      processorBlock: { slug: 'candidate-extractor', config: extractorConfig({ learningSteps: ['event-extractionn'] }) },
      withAgent: true,
      withStep: true,
    });

    expect(result.errors).toContainEqual(expect.objectContaining({
      resource: 'source',
      slug: 'listings',
      message: expect.stringContaining('unknown learning step'),
    }));
    expect(await storedConfig()).toBeUndefined();
  });

  it('fails that source when it names an agent the org does not have', async () => {
    const result = await apply({
      processorBlock: { slug: 'candidate-extractor', config: extractorConfig() },
      withStep: true,
    });

    expect(result.errors).toContainEqual(expect.objectContaining({
      resource: 'source',
      slug: 'listings',
      message: expect.stringContaining('unknown agent'),
    }));
  });

  it('accepts a step and an agent this very apply is creating', async () => {
    // Steps and agents are applied before sources, but a dry run writes
    // nothing, so the check reads the manifest as well as the tables, or the
    // first apply of a complete workspace would fail on its own contents.
    const dryRun = await applyWorkspace(
      loadWorkspace(writeFixture({
        processorBlock: { slug: 'candidate-extractor', config: extractorConfig({ learningSteps: [STEP] }) },
        withAgent: true,
        withStep: true,
      })),
      { orgId: ORG, dryRun: true },
    );

    expect(dryRun.errors).toEqual([]);
  });
});
