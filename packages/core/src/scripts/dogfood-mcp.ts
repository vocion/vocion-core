import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { readConfig } from '@/interfaces/mcp/config';
import { buildServer } from '@/interfaces/mcp/server';
import { loadPlugins } from '@/libs/plugins';
/**
 * Dogfood the MCP server end-to-end against the real DB + real workspace repo.
 *
 * Launches an in-memory client/server pair and runs a realistic sequence:
 *   1. workspace_list  — what's there today
 *   2. workspace_write_skill — add a tiny demo skill
 *   3. workspace_version_history — show audit trail now has a new row
 *   4. workspace_diff — confirm no pending changes
 *   5. workspace_delete — clean up
 *
 * Prints progress so you can watch the flow. Exits non-zero on any failure.
 */
import 'dotenv/config';

type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

async function call<T = unknown>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content?.find(c => c.type === 'text')?.text ?? '{}';
  if (result.isError) {
    throw new Error(`tool ${name} failed: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const config = readConfig();
  console.log(`→ contextPath: ${config.contextPath}`);
  console.log(`→ orgId: ${config.orgId}`);

  const pluginResult = await loadPlugins({ orgId: config.orgId });
  console.log(`→ plugins loaded: ${pluginResult.loaded.map(p => p.pluginId).join(', ') || '(none)'}`);
  if (pluginResult.errors.length > 0) {
    console.log(`  plugin errors: ${pluginResult.errors.map(e => e.source).join(', ')}`);
  }
  console.log();

  const server = buildServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'dogfood-client', version: '0.0.0' });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    // 1. Baseline
    const before = await call<{ sha: string; skills: Array<{ slug: string }> }>(client, 'workspace_list');
    console.log(`1. workspace_list → sha=${before.sha}, ${before.skills.length} skills`);

    // 2. Write a harmless demo skill
    console.log('\n2. workspace_write_skill — adding mcp_dogfood_demo…');
    const written = await call<{
      written: { slug: string; files: string[] };
      commit: { committed: boolean; sha: string | null } | null;
      apply: { counts: { skills: { created: number; updated: number; unchanged: number } }; versionId: number | null } | { error: string };
    }>(client, 'workspace_write_skill', {
      manifest: {
        slug: 'mcp_dogfood_demo',
        name: 'MCP Dogfood Demo',
        description: 'Temporary skill to verify MCP auto-apply. Safe to delete.',
        category: 'query',
        status: 'draft',
        version: 1,
        requiresApproval: false,
        model: 'gpt-5.4-mini',
        temperature: '0.1',
      },
      prompt_md: 'Echo back: {{input}}\n',
      commitMessage: 'mcp dogfood: add demo skill',
    });
    console.log(`   files: ${written.written.files.length}, commit=${written.commit?.sha ?? 'n/a'}`);
    if ('counts' in written.apply!) {
      console.log(`   apply: created=${written.apply.counts.skills.created} updated=${written.apply.counts.skills.updated}`);
    } else {
      throw new Error(`apply failed: ${written.apply!.error}`);
    }

    // 3. Audit trail now has a row
    const history = await call<Array<{ sha: string; appliedBy: string; appliedAt: string }>>(client, 'workspace_version_history', { limit: 3 });
    console.log(`\n3. workspace_version_history → ${history.length} recent rows`);
    for (const row of history.slice(0, 3)) {
      console.log(`   ${row.sha}  by=${row.appliedBy}  at=${row.appliedAt}`);
    }

    // 4. Diff is clean
    const diff = await call<{ counts: { skills: { unchanged: number } } }>(client, 'workspace_diff');
    console.log(`\n4. workspace_diff → skills unchanged=${diff.counts.skills.unchanged}`);

    // 5. Plugins list — verify any loaded plugins show up via MCP
    const plugins = await call<{ plugins: Array<{ id: string; version: string }>; skills: Array<{ slug: string; pluginId: string }> }>(client, 'plugins_list');
    console.log(`\n5. plugins_list → ${plugins.plugins.length} plugin(s), ${plugins.skills.length} skill(s)`);
    for (const s of plugins.skills) {
      console.log(`   ${s.pluginId} :: ${s.slug}`);
    }

    // 6. Clean up
    console.log('\n6. workspace_delete — removing mcp_dogfood_demo…');
    const deleted = await call<{ removed: string[]; dbRowsDeleted: number }>(client, 'workspace_delete', { kind: 'skill', slug: 'mcp_dogfood_demo' });
    console.log(`   removed ${deleted.removed.length} files, ${deleted.dbRowsDeleted} db rows`);

    console.log('\n✓ dogfood passed');
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
