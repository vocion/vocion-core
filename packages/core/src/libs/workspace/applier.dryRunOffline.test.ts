/**
 * A dry-run never needs a database.
 *
 * `workspace:check` is the guard a deploy repo runs on every PR, in a bare
 * node image with `DATABASE_URL` pointing at a port nothing listens on. It
 * used to die on the first `select` — before it had validated a single
 * manifest — so the check failed on every PR, was ignored, and guarded
 * nothing. A dry-run now probes the database once; with no answer it still
 * validates every manifest and reports what it would apply, with the
 * created/updated split left `unknown` and said so on `result.database`.
 *
 * Deliberately NOT `vi.mock('@/libs/DB')`: the point is the real driver
 * against a port that refuses the connection.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

/** A local port nothing listens on: bind an ephemeral one, then release it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
  return port;
}

// Before anything imports `@/libs/DB`, which reads Env.DATABASE_URL and keeps
// one pool per process on globalThis.
vi.stubEnv('DATABASE_URL', `postgresql://nobody:nobody@127.0.0.1:${await closedPort()}/closed`);
delete (globalThis as { drizzle?: unknown }).drizzle;

const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');

const ORG = 'proj_offline_factory';

/**
 * The software-factory plugin's own resources — object types, skills, a
 * team, agents, missions, automations, playbooks, trust rules — with the
 * one thing a plugin cannot ship: the accountable person.
 * @param extra - More files to write under the workspace, path → body.
 */
function writeFixture(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-offline-dry-run-'));
  writeFileSync(
    join(dir, 'workspace.yaml'),
    `version: 1\norgId: ${ORG}\nname: Offline factory\naccountableUser: owner@northwind.example\nplugins: [software-factory]\n`,
  );
  for (const [rel, body] of Object.entries(extra)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('a dry-run with no database', () => {
  it('validates the software-factory workspace and reports what it would apply, with zero errors', async () => {
    const dir = writeFixture();
    dirs.push(dir);
    const loaded = loadWorkspace(dir);

    const result = await applyWorkspace(loaded, { dryRun: true, orgId: ORG });

    expect(result.errors).toEqual([]);
    expect(result.dryRun).toBe(true);
    expect(result.versionId).toBeNull();
    expect(result.database.reachable).toBe(false);

    if (!result.database.reachable) {
      expect(result.database.reason).toMatch(/ECONNREFUSED/);
    }

    // Everything the plugin ships is accounted for — none of it classified,
    // because created-or-updated is a question only the database can answer.
    const authored = loaded.objectTypes.length + loaded.skills.length + loaded.teams.length + loaded.agents.length
      + loaded.workflows.length + loaded.missions.length + loaded.automations.length + loaded.playbooks.length
      + loaded.learningSteps.length + loaded.evalDatasets.length + loaded.sources.length;
    const unknown = Object.values(result.counts).reduce((n, c) => n + (c.unknown ?? 0), 0);
    const classified = Object.values(result.counts).reduce((n, c) => n + c.created + c.updated + c.unchanged, 0);

    expect(authored).toBeGreaterThan(0);
    expect(unknown).toBe(authored);
    expect(classified).toBe(0);
    expect(result.counts.agents).toEqual({ created: 0, updated: 0, unchanged: 0, unknown: loaded.agents.length });
    expect(result.counts.teams.unknown).toBe(1);
  });

  it('validates seeded wiki pages and counts them as unknown — created or refreshed is the database\'s to say', async () => {
    const dir = writeFixture({
      'wiki/voice.md': '---\ntitle: Voice\nsummary: How we sound.\n---\nPlain and short.\n',
      'wiki/who-is-who.md': '---\ntitle: Who is who\n---\nChris owns the workspace.\n',
    });
    dirs.push(dir);

    const result = await applyWorkspace(loadWorkspace(dir), { dryRun: true, orgId: ORG });

    expect(result.database.reachable).toBe(false);
    expect(result.errors).toEqual([]);
    // Two files and the index the apply would generate from them.
    expect(result.counts.wikiPages).toEqual({ created: 0, updated: 0, unchanged: 0, unknown: 3 });
  });

  it('a wiki page that breaks the contract fails the load with the file named', async () => {
    const dir = writeFixture({ 'wiki/bad.md': '---\nsummary: no title\n---\nBody.\n' });
    dirs.push(dir);

    expect(() => loadWorkspace(dir)).toThrow(/wiki\/bad\.md[\s\S]*title/);
  });

  it('still fails a real manifest error — an unknown connector kind', async () => {
    const dir = writeFixture({
      'sources/listings.yaml': 'slug: listings\nname: Listings\nkind: no-such-connector\nconfig: {}\n',
    });
    dirs.push(dir);

    const result = await applyWorkspace(loadWorkspace(dir), { dryRun: true, orgId: ORG });

    expect(result.database.reachable).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ resource: 'source', slug: 'listings', message: expect.stringContaining('unknown connector kind') }),
    ]);
    expect(result.counts.sources).toEqual({ created: 0, updated: 0, unchanged: 0 });
  });
});
