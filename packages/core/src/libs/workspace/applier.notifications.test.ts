/**
 * Notification kinds are declared, never implicit (backlog 048): the
 * `notifications:` block in plugin.yaml and workspace.yaml, validated by the
 * schema, composed by the loader (a workspace entry replaces a plugin's by
 * kind), stored by the applier, and disabled when no longer declared.
 */
import type { LoadedPlugin } from './plugins';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { notificationRuleSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { composeNotifications, loadWorkspace } = await import('./loader');
const { listPlugins } = await import('./plugins');
const { PluginManifestSchema, WorkspaceManifestSchema } = await import('./schemas');
const { FACTORY_STOPPED, RELEASE_LINKED } = await import('@/services/EventService');

const ORG = 'proj_notifications_apply';
const dirs: string[] = [];

function workspaceWith(notifications: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-notifications-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: notifications\n${notifications}`);
  return dir;
}

beforeEach(async () => {
  await db.delete(notificationRuleSchema);
});

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

const base = { slug: 'p', name: 'P', version: '1.0.0', description: 'd', depends: [], surfaces: [], nav: { section: 'Workspace', order: 0 }, recommend: { when: [], connectors: [] } };
const plugin = (slug: string, notifications: unknown[]): LoadedPlugin => ({ manifest: PluginManifestSchema.parse({ ...base, slug, notifications }), sourcePath: `/plugins/${slug}` });
const rule = (kind: string, extra: Record<string, unknown> = {}) => ({ kind, label: kind, event: 'thing.happened', title: 'It happened', ...extra });

describe('the notifications: block', () => {
  it('composes plugins then the workspace, a workspace kind replacing a plugin\'s whole', () => {
    const composed = composeNotifications(
      [plugin('alpha', [rule('shipped'), rule('stuck')])],
      WorkspaceManifestSchema.parse({ version: 1, orgId: ORG, name: 'w', notifications: [rule('stuck', { status: 'disabled' }), rule('ours')] }),
    );

    expect(composed.map(n => [n.kind, n.source, n.status])).toEqual([
      ['shipped', 'plugin:alpha', 'active'],
      ['stuck', 'workspace', 'disabled'],
      ['ours', 'workspace', 'active'],
    ]);
  });

  it('refuses one kind from two plugins, a kind twice in one layer, an outside link, an unknown key', () => {
    expect(() => composeNotifications([plugin('alpha', [rule('shipped')]), plugin('beta', [rule('shipped')])], { notifications: [] })).toThrow(/declared by both plugin:alpha and plugin:beta/);
    expect(() => PluginManifestSchema.parse({ ...base, notifications: [rule('a'), rule('a')] })).toThrow(/declared twice/);
    expect(() => PluginManifestSchema.parse({ ...base, notifications: [rule('a', { link: 'https://evil.example/x' })] })).toThrow(/app path/);
    expect(() => PluginManifestSchema.parse({ ...base, notifications: [rule('a', { channels: ['email'] })] })).toThrow();
  });

  it('the software factory declares exactly two kinds, on events core raises', () => {
    const factory = listPlugins().find(p => p.manifest.slug === 'software-factory')!;

    expect(factory.manifest.notifications.map(n => [n.kind, n.event])).toEqual([
      ['needs-person', FACTORY_STOPPED],
      ['released', RELEASE_LINKED],
    ]);
    expect(factory.manifest.notifications.find(n => n.kind === 'released')!.filter).toEqual({ userFacing: true });
  });
});

describe('applying notification kinds', () => {
  it('stores each declared kind, leaves it alone when unchanged, and disables one no longer declared', async () => {
    const two = workspaceWith(`notifications:\n  - {kind: shipped, label: Shipped, event: thing.shipped, title: 'Shipped {name}'}\n  - {kind: stuck, label: Stuck, event: thing.stuck, title: 'Stuck'}\n`);
    const first = await applyWorkspace(loadWorkspace(two), { orgId: ORG });

    expect(first.counts.notifications).toEqual({ created: 2, updated: 0, unchanged: 0 });

    const again = await applyWorkspace(loadWorkspace(two), { orgId: ORG });

    expect(again.counts.notifications).toEqual({ created: 0, updated: 0, unchanged: 2 });

    const one = workspaceWith(`notifications:\n  - {kind: shipped, label: Shipped, event: thing.shipped, title: 'Shipped {name}!'}\n`);
    const third = await applyWorkspace(loadWorkspace(one), { orgId: ORG });

    // The kind it no longer declares is counted, and named, as retired.
    expect(third.counts.notifications).toEqual({ created: 0, updated: 1, unchanged: 0, retired: 1 });
    expect(third.changes).toContainEqual({ resource: 'notifications', slug: 'stuck', outcome: 'retired' });
    expect(third.warnings).toContainEqual(expect.objectContaining({ resource: 'notification', slug: 'stuck' }));

    const rows = await db.select().from(notificationRuleSchema).where(eq(notificationRuleSchema.orgId, ORG));

    expect(rows.map(r => [r.kind, r.status, r.source, r.config.title]).sort()).toEqual([
      ['shipped', 'active', 'workspace', 'Shipped {name}!'],
      ['stuck', 'disabled', 'workspace', 'Stuck'],
    ]);
  });
});
