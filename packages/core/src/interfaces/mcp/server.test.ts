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
 *   - context_diff shows no pending changes after apply
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
  writeFileSync(join(contextDir, 'context.yaml'), 'version: 1\norgId: test_org_mcp\nname: test\n');
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
    autoCommit: true,
    autoApply: true,
    serverName: 'corecontext-test',
    serverVersion: '0.0.0',
  };
  const server = buildServer(config);
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

        expect(names).toContain('context_list');
        expect(names).toContain('context_write_skill');
        expect(names).toContain('runtime_run_skill');
        expect(names).toContain('search_query');
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
        const result = await client.callTool({ name: 'context_list', arguments: {} });
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
          name: 'context_write_skill',
          arguments: {
            manifest: {
              slug: 'hello_world',
              name: 'Hello World',
              description: 'test skill',
              category: 'query',
              status: 'active',
              version: 1,
              requiresApproval: false,
            },
            prompt_md: 'Say hello to {{name}}.',
            autoCommit: true,
          },
        });
        const write = parseToolResult<{
          written: { slug: string; files: string[] };
          commit: { committed: boolean; sha: string | null } | null;
          apply: { counts: { skills: { created: number } }; versionId: number | null } | { error: string };
        }>(writeResult as ToolResult);

        expect(write.written.slug).toBe('hello_world');
        expect(write.commit?.committed).toBe(true);
        expect(write.commit?.sha).toMatch(/^[a-f0-9]{12}$/);
        expect('counts' in write.apply! && write.apply.counts.skills.created).toBe(1);

        // Verify git log
        const log = execSync('git log --oneline', { cwd: scratch.root, encoding: 'utf8' });

        expect(log).toContain('chore(context): update skill hello_world');

        // List shows it
        const list = parseToolResult<{ skills: Array<{ slug: string }> }>(
          await client.callTool({ name: 'context_list', arguments: {} }) as ToolResult,
        );

        expect(list.skills).toHaveLength(1);
        expect(list.skills[0]!.slug).toBe('hello_world');

        // Get returns full prompt
        const got = parseToolResult<{ slug: string; resolvedPromptTemplate: string }>(
          await client.callTool({ name: 'context_get', arguments: { kind: 'skill', slug: 'hello_world' } }) as ToolResult,
        );

        expect(got.resolvedPromptTemplate).toBe('Say hello to {{name}}.');

        // Diff is clean (no pending)
        const diff = parseToolResult<{ counts: { skills: { created: number; updated: number; unchanged: number } } }>(
          await client.callTool({ name: 'context_diff', arguments: {} }) as ToolResult,
        );

        expect(diff.counts.skills.created).toBe(0);
        expect(diff.counts.skills.updated).toBe(0);
        expect(diff.counts.skills.unchanged).toBe(1);

        // Version history has at least one row
        const history = parseToolResult<Array<{ sha: string }>>(
          await client.callTool({ name: 'context_version_history', arguments: { limit: 5 } }) as ToolResult,
        );

        expect(history.length).toBeGreaterThanOrEqual(1);
        expect(history[0]!.sha).toBeDefined();

        // Rewrite with changed description → updated=1
        const reWrite = parseToolResult<{ apply: { counts: { skills: { updated: number } } } | { error: string } }>(
          await client.callTool({
            name: 'context_write_skill',
            arguments: {
              manifest: {
                slug: 'hello_world',
                name: 'Hello World (v2)',
                description: 'now improved',
                category: 'query',
                status: 'active',
                version: 2,
                requiresApproval: false,
              },
              prompt_md: 'Say hello to {{name}}.',
            },
          }) as ToolResult,
        );

        expect('counts' in reWrite.apply && reWrite.apply.counts.skills.updated).toBe(1);

        // Delete
        const del = parseToolResult<{ removed: string[]; dbRowsDeleted: number }>(
          await client.callTool({ name: 'context_delete', arguments: { kind: 'skill', slug: 'hello_world' } }) as ToolResult,
        );

        expect(del.removed.length).toBeGreaterThan(0);
        expect(del.dbRowsDeleted).toBe(1);

        const afterDelete = parseToolResult<{ skills: unknown[] }>(
          await client.callTool({ name: 'context_list', arguments: {} }) as ToolResult,
        );

        expect(afterDelete.skills).toEqual([]);
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
          name: 'context_write_skill',
          arguments: {
            manifest: {
              slug: 'Bad-Slug-Caps',
              name: 'bad',
              category: 'query',
              status: 'active',
              version: 1,
              requiresApproval: false,
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
