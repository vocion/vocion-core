import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins } from './loader';
import { pluginRegistry } from './registry';

/**
 * Writes a plugin module to disk and returns its absolute path so we can
 * pass it in VOCION_PLUGINS. Uses .mjs so Node loads it as ESM without
 * needing tsx/config.
 * @param dir
 * @param name
 * @param contents
 */
function writePlugin(dir: string, name: string, contents: string): string {
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, contents);
  return path;
}

describe('plugin loader', () => {
  beforeEach(() => {
    pluginRegistry.clear();
  });

  it('loads a plugin from a file path with eager skills array', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-plugin-'));
    try {
      const path = writePlugin(dir, 'hello', `
import { z } from 'zod';

const hello = {
  slug: 'plugin_hello',
  name: 'Hello',
  version: '1.0.0',
  requiresApproval: false,
  inputSchema: z.object({ name: z.string() }),
  outputSchema: z.object({ greeting: z.string() }),
  async run(_ctx, input) { return { greeting: 'hi ' + input.name }; },
};

export default { id: 'test.hello', version: '0.0.1', skills: [hello] };
`);

      const result = await loadPlugins({ orgId: 'test', env: { VOCION_PLUGINS: path } });

      expect(result.errors).toEqual([]);
      expect(result.loaded).toEqual([{ pluginId: 'test.hello', skills: ['plugin_hello'] }]);
      expect(pluginRegistry.getSkill('plugin_hello')?.slug).toBe('plugin_hello');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('loads via a register() factory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-plugin-factory-'));
    try {
      const path = writePlugin(dir, 'factory', `
import { z } from 'zod';

export default {
  id: 'test.factory',
  version: '0.1.0',
  register(env) {
    return [{
      slug: 'factory_' + env.orgId,
      name: 'Factory Skill',
      version: '0.1.0',
      requiresApproval: false,
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      async run() { return { ok: true }; },
    }];
  },
};
`);

      const result = await loadPlugins({ orgId: 'org_xyz', env: { VOCION_PLUGINS: path } });

      expect(result.errors).toEqual([]);
      expect(pluginRegistry.getSkill('factory_org_xyz')).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('isolates errors — one bad plugin does not prevent the others', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-plugin-iso-'));
    try {
      const good = writePlugin(dir, 'good', `
import { z } from 'zod';
export default {
  id: 'test.good', version: '1', skills: [{
    slug: 'good_skill', name: 'g', version: '1', requiresApproval: false,
    inputSchema: z.object({}), outputSchema: z.object({}),
    async run() { return {}; },
  }],
};
`);
      const bad = writePlugin(dir, 'bad', 'export default { not: "a manifest" };');

      const result = await loadPlugins({ orgId: 'test', env: { VOCION_PLUGINS: [good, bad].join(',') } });

      expect(result.loaded.map(l => l.pluginId)).toContain('test.good');
      expect(result.errors.some(e => e.source === bad)).toBe(true);
      expect(pluginRegistry.getSkill('good_skill')).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns empty when no plugins configured', async () => {
    const result = await loadPlugins({ orgId: 'test', env: { VOCION_PLUGINS: '' } });

    expect(result.loaded).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('rejects manifests missing both skills and register', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cc-plugin-noop-'));
    try {
      const path = writePlugin(dir, 'empty', `export default { id: 'test.empty', version: '1' };`);
      const result = await loadPlugins({ orgId: 'test', env: { VOCION_PLUGINS: path } });

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.message).toMatch(/skills|register/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
