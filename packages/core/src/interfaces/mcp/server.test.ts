import type { McpConfig } from './config';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { buildServer } from './server';

vi.mock('@/libs/DB');

/**
 * End-to-end MCP loop: in-memory client ↔ server, scratch git repo for the
 * context dir, PGLite DB from the mock. Verifies:
 *   - list/get on an empty context
 *   - write_skill → files on disk, commit made, DB row created
 *   - workspace_diff shows no pending changes after apply
 *   - write again → updated=1
 *   - version_history has rows
 *   - delete removes files + DB row
 */

function scratchContext(): { root: string; contextDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cc-mcp-'));
  execSync('git init -q -b main', { cwd: root });
  execSync('git config user.email test@example.com', { cwd: root });
  execSync('git config user.name test', { cwd: root });
  const contextDir = join(root, 'context');
  execSync(`mkdir -p ${contextDir}`);
  writeFileSync(join(contextDir, 'workspace.yaml'), 'version: 1\norgId: test_org_mcp\nname: test\n');
  execSync('git add -A', { cwd: root });
  execSync('git commit -q -m initial', { cwd: root });
  return {
    root,
    contextDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function setupClientServer(contextDir: string) {
  const config: McpConfig = {
    orgId: 'test_org_mcp',
    contextPath: contextDir,
    diskWorkspace: true,
    autoCommit: true,
    autoApply: true,
    serverName: 'vocion-test',
    serverVersion: '0.0.0',
  };
  const server = await buildServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

function parseToolResult<T = unknown>(result: ToolResult): T {
  const text = result.content?.find(c => c.type === 'text')?.text;
  if (result.isError) {
    throw new Error(text ?? 'tool error');
  }
  return JSON.parse(text ?? '{}') as T;
}

describe('MCP server (end-to-end)', () => {
  it('lists tools', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const list = await client.listTools();
        const names = list.tools.map(t => t.name);

        expect(names).toContain('workspace_list');
        expect(names).toContain('workspace_write_skill');
        expect(names).toContain('workspace_write_playbook');
        expect(names).toContain('workspace_write_mission');
        expect(names).toContain('search_query');
        expect(names).toContain('teams_list');
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });

  it('reports empty context on a fresh repo', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const result = await client.callTool({ name: 'workspace_list', arguments: {} });
        const data = parseToolResult<{ agents: unknown[]; skills: unknown[]; objectTypes: unknown[] }>(result as ToolResult);

        expect(data.skills).toEqual([]);
        expect(data.agents).toEqual([]);
        expect(data.objectTypes).toEqual([]);
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });

  it('full loop: write_skill → auto-commit → auto-apply → list → get → delete', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        // Write a skill — opt into autoCommit since default is now false
        const writeResult = await client.callTool({
          name: 'workspace_write_skill',
          arguments: {
            manifest: {
              slug: 'hello-world',
              name: 'Hello World',
              description: 'test skill',
              version: 1,
            },
            prompt_md: 'Say hello and be brief.',
            autoCommit: true,
          },
        });
        const write = parseToolResult<{
          written: { slug: string; files: string[] };
          commit: { committed: boolean; sha: string | null } | null;
          apply: { counts: { skills: { created: number } }; versionId: number | null } | { error: string };
        }>(writeResult as ToolResult);

        expect(write.written.slug).toBe('hello-world');
        expect(write.commit?.committed).toBe(true);
        expect(write.commit?.sha).toMatch(/^[a-f0-9]{12}$/);
        expect('counts' in write.apply! && write.apply.counts.skills.created).toBe(1);

        // Verify git log
        const log = execSync('git log --oneline', { cwd: scratch.root, encoding: 'utf8' });

        expect(log).toContain('chore(context): update skill hello-world');

        // List shows it
        const list = parseToolResult<{ skills: Array<{ slug: string }> }>(
          await client.callTool({ name: 'workspace_list', arguments: {} }) as ToolResult,
        );

        expect(list.skills).toHaveLength(1);
        expect(list.skills[0]!.slug).toBe('hello-world');

        // Get returns the full body
        const got = parseToolResult<{ slug: string; body: string }>(
          await client.callTool({ name: 'workspace_get', arguments: { kind: 'skill', slug: 'hello-world' } }) as ToolResult,
        );

        expect(got.body).toBe('Say hello and be brief.');

        // Diff is clean (no pending)
        const diff = parseToolResult<{ counts: { skills: { created: number; updated: number; unchanged: number } } }>(
          await client.callTool({ name: 'workspace_diff', arguments: {} }) as ToolResult,
        );

        expect(diff.counts.skills.created).toBe(0);
        expect(diff.counts.skills.updated).toBe(0);
        expect(diff.counts.skills.unchanged).toBe(1);

        // Version history has at least one row
        const history = parseToolResult<Array<{ sha: string }>>(
          await client.callTool({ name: 'workspace_version_history', arguments: { limit: 5 } }) as ToolResult,
        );

        expect(history.length).toBeGreaterThanOrEqual(1);
        expect(history[0]!.sha).toBeDefined();

        // Rewrite with changed description → updated=1
        const reWrite = parseToolResult<{ apply: { counts: { skills: { updated: number } } } | { error: string } }>(
          await client.callTool({
            name: 'workspace_write_skill',
            arguments: {
              manifest: {
                slug: 'hello-world',
                name: 'Hello World (v2)',
                description: 'now improved',
                version: 2,
              },
              prompt_md: 'Say hello and be brief.',
            },
          }) as ToolResult,
        );

        expect('counts' in reWrite.apply && reWrite.apply.counts.skills.updated).toBe(1);

        // Delete
        const del = parseToolResult<{ removed: string[]; dbRowsDeleted: number }>(
          await client.callTool({ name: 'workspace_delete', arguments: { kind: 'skill', slug: 'hello-world' } }) as ToolResult,
        );

        expect(del.removed.length).toBeGreaterThan(0);
        expect(del.dbRowsDeleted).toBe(1);

        const afterDelete = parseToolResult<{ skills: unknown[] }>(
          await client.callTool({ name: 'workspace_list', arguments: {} }) as ToolResult,
        );

        expect(afterDelete.skills).toEqual([]);
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });

  it('write_mission and write_playbook: the same loop, and the mission mirrors into an artifact', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const mission = parseToolResult<{
          written: { kind: string; slug: string; files: string[] };
          apply: { counts: { missions: { created: number } }; versionId: number | null } | { error: string };
        }>(await client.callTool({
          name: 'workspace_write_mission',
          arguments: {
            manifest: { slug: 'keep-main-releasable', name: 'Keep main releasable', goal: 'Every merge to main ships.', agent: 'release-lead' },
            autoCommit: true,
          },
        }) as ToolResult);

        expect(mission.written.kind).toBe('mission');
        expect(mission.written.files[0]).toMatch(/missions\/keep-main-releasable\.yaml$/);
        expect('counts' in mission.apply && mission.apply.counts.missions.created).toBe(1);

        const playbook = parseToolResult<{
          written: { kind: string; slug: string };
          apply: { counts: { playbooks: { created: number } } } | { error: string };
        }>(await client.callTool({
          name: 'workspace_write_playbook',
          arguments: {
            manifest: { slug: 'house-style', name: 'House style', description: 'How we write.' },
            prompt_md: 'Short sentences.',
          },
        }) as ToolResult);

        expect(playbook.written.kind).toBe('playbook');
        expect('counts' in playbook.apply && playbook.apply.counts.playbooks.created).toBe(1);

        const list = parseToolResult<{ missions: Array<{ slug: string; goal: string }>; playbooks: Array<{ slug: string }> }>(
          await client.callTool({ name: 'workspace_list', arguments: {} }) as ToolResult,
        );

        expect(list.missions).toEqual([expect.objectContaining({ slug: 'keep-main-releasable', goal: 'Every merge to main ships.' })]);
        expect(list.playbooks.map(p => p.slug)).toEqual(['house-style']);

        const got = parseToolResult<{ slug: string; goal: string; autonomyPolicy: { level: number } }>(
          await client.callTool({ name: 'workspace_get', arguments: { kind: 'mission', slug: 'keep-main-releasable' } }) as ToolResult,
        );

        expect(got.autonomyPolicy.level).toBe(1);

        // The apply mirrored the file into its artifact (libs/workspace/source.ts).
        const { getSourceArtifact } = await import('@/services/workspace/WorkspaceSourceService');
        const mirror = await getSourceArtifact('test_org_mcp', 'mission', 'keep-main-releasable');

        expect(mirror).toMatchObject({ kind: 'mission', title: 'Keep main releasable', currentVersion: 1 });
        expect(String((mirror!.spec as { yaml: string }).yaml)).toContain('goal: Every merge to main ships.');

        const badMission = (await client.callTool({
          name: 'workspace_write_mission',
          arguments: { manifest: { slug: 'no-goal', name: 'No goal', agent: 'release-lead' } },
        })) as ToolResult;

        expect(badMission.isError).toBe(true);
        expect(badMission.content?.[0]?.text).toMatch(/goal/);

        const del = parseToolResult<{ removed: string[]; dbRowsDeleted: number }>(
          await client.callTool({ name: 'workspace_delete', arguments: { kind: 'mission', slug: 'keep-main-releasable' } }) as ToolResult,
        );

        expect(del.removed).toHaveLength(1);
        expect(del.dbRowsDeleted).toBe(1);
        // …and the mirror went with the row: no editable copy of a deleted file.
        expect(await getSourceArtifact('test_org_mcp', 'mission', 'keep-main-releasable')).toBeNull();
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });

  it('returns structured validation error on bad input', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const result = (await client.callTool({
          name: 'workspace_write_skill',
          arguments: {
            manifest: {
              slug: 'Bad-Slug-Caps',
              name: 'bad',
              description: 'bad slug',
              version: 1,
            },
            prompt_md: 'x',
          },
        })) as ToolResult;

        expect(result.isError).toBe(true);
        expect(result.content?.[0]?.text).toMatch(/slug/i);
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });
});
