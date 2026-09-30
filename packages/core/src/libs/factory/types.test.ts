/**
 * The factory's types come from the plugin that declares them (backlog 045).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listPluginSlugs, loadPlugin } from '@/libs/workspace/plugins';
import { factoryRoleOf } from './types';

describe('factory types', () => {
  it('every role a plugin names is an object type that plugin ships', () => {
    const declaring = listPluginSlugs().map(loadPlugin).filter(p => p.manifest.factory);

    expect(declaring.length).toBeGreaterThan(0);

    for (const plugin of declaring) {
      for (const [role, slug] of Object.entries(plugin.manifest.factory!.types)) {
        expect(existsSync(join(plugin.sourcePath, 'objects', slug)), `${plugin.manifest.slug} factory.types.${role} names "${slug}", which it does not ship`).toBe(true);
      }
    }
  });

  it('names the role a type plays, and none for a type outside the loop', () => {
    const types = { request: 'ask_item', task: 'work_item', plan: 'design_note', environment: 'stage_site', release: 'ship_note', product: 'offering', repo: 'codebase' };

    expect(factoryRoleOf(types, 'work_item')).toBe('task');
    expect(factoryRoleOf(types, 'contact')).toBeNull();
    expect(factoryRoleOf(types, null)).toBeNull();
  });
});
