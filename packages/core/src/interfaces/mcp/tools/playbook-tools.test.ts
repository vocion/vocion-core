import type { McpConfig } from '../config';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server';

/**
 * `playbook_get` (vocion-core#108) — this is the entry point that actually
 * takes attacker input over MCP, so the containment guard in `readByOrigin`
 * needs a test at THIS boundary, not just at the function it calls into
 * (covered separately in `services/playbooks/mount.test.ts`). Setup mirrors
 * `../server.test.ts`'s in-memory client/server harness.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { playbookSchema } = await import('@/models/Schema');

const ORG = 'org_playbook_tools_mcp';
const SKILL_BODY = '# House style\n\nWrite plainly.\n';
const REFERENCE_BODY = '# Reference\n\nA sibling resource inside the folder.\n';
const SECRET = 'DB_PASSWORD=leaked-if-playbook_get-has-no-guard\n';

/** A scratch git repo, same shape `../server.test.ts` gives `buildServer` for its context tools. */
function scratchContext(): { root: string; contextDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'cc-mcp-playbook-'));
  execSync('git init -q -b main', { cwd: root });
  execSync('git config user.email test@example.com', { cwd: root });
  execSync('git config user.name test', { cwd: root });
  const contextDir = join(root, 'context');
  execSync(`mkdir -p ${contextDir}`);
  writeFileSync(join(contextDir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: test\n`);
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
    orgId: ORG,
    contextPath: contextDir,
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

/**
 * Playbook-shaped workspace fixture — `readByOrigin` reads it via
 * `WORKSPACE_PATH`, entirely separate from the git scratch context above
 * that `workspace_*` tools use. A file outside the playbook folder stands
 * in for the secret a traversal `resource` should never be able to reach.
 */
const WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), 'vocion-ws-playbook-tools-'));
mkdirSync(join(WORKSPACE_ROOT, 'playbooks', 'house-style'), { recursive: true });
writeFileSync(join(WORKSPACE_ROOT, 'playbooks', 'house-style', 'SKILL.md'), SKILL_BODY);
writeFileSync(join(WORKSPACE_ROOT, 'playbooks', 'house-style', 'REFERENCE.md'), REFERENCE_BODY);
writeFileSync(join(WORKSPACE_ROOT, '.env'), SECRET);

const ORIGINAL_WORKSPACE_PATH = process.env.WORKSPACE_PATH;

beforeEach(async () => {
  process.env.WORKSPACE_PATH = WORKSPACE_ROOT;
  await db.delete(playbookSchema);
  await db.insert(playbookSchema).values([
    {
      orgId: ORG,
      slug: 'house-style',
      name: 'House style',
      description: 'How we write.',
      kind: 'playbook',
      origin: 'workspace',
      contentSha: 'sha-house-style',
      sourceFiles: ['REFERENCE.md'],
    },
  ]);
});

afterEach(async () => {
  await db.delete(playbookSchema);
  if (ORIGINAL_WORKSPACE_PATH === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = ORIGINAL_WORKSPACE_PATH;
  }
});

afterAll(() => {
  rmSync(WORKSPACE_ROOT, { recursive: true, force: true });
});

describe('playbook_get (MCP tool boundary, vocion-core#108)', () => {
  it('returns an error result for a traversal resource instead of file contents from outside the playbook folder', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const result = (await client.callTool({
          name: 'playbook_get',
          arguments: { slug: 'house-style', resource: '../../../../.env' },
        })) as ToolResult;

        expect(result.isError).toBe(true);

        const text = result.content?.find(c => c.type === 'text')?.text ?? '';

        expect(text).not.toContain(SECRET);
        expect(text).not.toContain('DB_PASSWORD');
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });

  it('falls back to SKILL.md when resource is omitted, exercising the `resource ?? \'SKILL.md\'` default', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const result = await client.callTool({ name: 'playbook_get', arguments: { slug: 'house-style' } });
        const data = parseToolResult<{ resource: string; content: string }>(result as ToolResult);

        expect(data.resource).toBe('SKILL.md');
        expect(data.content).toBe(SKILL_BODY);
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });

  it('returns a legitimate sibling resource inside the real playbook folder', async () => {
    const scratch = scratchContext();
    try {
      const { client, server } = await setupClientServer(scratch.contextDir);
      try {
        const result = await client.callTool({
          name: 'playbook_get',
          arguments: { slug: 'house-style', resource: 'REFERENCE.md' },
        });
        const data = parseToolResult<{ resource: string; content: string }>(result as ToolResult);

        expect(data.resource).toBe('REFERENCE.md');
        expect(data.content).toBe(REFERENCE_BODY);
      } finally {
        await server.close();
      }
    } finally {
      scratch.cleanup();
    }
  });
});
