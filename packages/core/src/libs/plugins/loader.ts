import type { AnySkill, PluginManifest } from '@compiles/sdk';
import { resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { z } from 'zod';
import { pluginRegistry } from './registry';

/**
 * Plugin discovery + validation.
 *
 * Two sources (checked in order):
 *
 *   1. `COMPILES_PLUGINS` env var — comma-separated module specifiers.
 *      (Legacy: `CORECONTEXT_PLUGINS` still works for one release with a
 *      deprecation warning; remove in v2.)
 *      Absolute or relative paths (resolved from cwd) OR package names
 *      installed in node_modules. Each entry is imported as an ES module
 *      and its default export is validated as `PluginManifest`.
 *
 *   2. (Future) `context/<org>/plugins.yaml` — declarative enablement +
 *      per-plugin config. Not yet wired; left as a TODO so the shape is
 *      documented.
 *
 * Plugin errors are isolated: one bad plugin logs + skips; the rest still
 * register. We deliberately do NOT sandbox (vm2/isolated-vm) in v0.1 —
 * plugins run in the same process. Sandboxing is Phase 3.5+ once we ship
 * third-party plugins to managed cloud.
 */

const SkillShapeZ = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  requiresApproval: z.boolean(),
  run: z.any(),
  inputSchema: z.any(),
  outputSchema: z.any(),
});

const ManifestShapeZ = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  skills: z.array(SkillShapeZ).optional(),
  register: z.any().optional(),
}).refine(m => Array.isArray(m.skills) || typeof m.register === 'function', {
  message: 'plugin must export either a `skills` array or a `register()` factory',
});

export type LoadResult = {
  loaded: Array<{ pluginId: string; skills: string[] }>;
  errors: Array<{ source: string; message: string }>;
};

export async function loadPlugins(opts: { orgId: string; env?: Readonly<Record<string, string | undefined>> } = { orgId: '' }): Promise<LoadResult> {
  const env = opts.env ?? process.env;
  // COMPILES_PLUGINS is the canonical env var. CORECONTEXT_PLUGINS is the
  // legacy alias kept for one release after the @compiles/core rename;
  // remove in v2.
  const spec = env.COMPILES_PLUGINS ?? env.CORECONTEXT_PLUGINS ?? '';
  if (env.CORECONTEXT_PLUGINS && !env.COMPILES_PLUGINS) {
    console.warn('[compiles] CORECONTEXT_PLUGINS is deprecated; rename to COMPILES_PLUGINS');
  }
  const specifiers = spec.split(',').map(s => s.trim()).filter(Boolean);

  const loaded: LoadResult['loaded'] = [];
  const errors: LoadResult['errors'] = [];

  for (const specifier of specifiers) {
    try {
      const manifest = await importPlugin(specifier);
      const skills = await resolveSkills(manifest, { orgId: opts.orgId, env });

      // Validate each skill shape — plugin authors may have forgotten a field.
      const validSkills: AnySkill[] = [];
      for (const skill of skills) {
        const shape = SkillShapeZ.safeParse(skill);
        if (!shape.success) {
          errors.push({ source: `${manifest.id}/${(skill as { slug?: string } | undefined)?.slug ?? '<unknown>'}`, message: shape.error.issues.map(i => i.message).join('; ') });
          continue;
        }
        validSkills.push(skill);
      }

      pluginRegistry.register(manifest, validSkills);
      loaded.push({ pluginId: manifest.id, skills: validSkills.map(s => s.slug) });
    } catch (err) {
      errors.push({ source: specifier, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { loaded, errors };
}

async function importPlugin(specifier: string): Promise<PluginManifest> {
  const resolved = specifier.startsWith('.') || specifier.startsWith('/')
    ? resolvePath(process.cwd(), specifier)
    : specifier;

  const mod = await import(resolved) as { default?: unknown; manifest?: unknown };
  const candidate = mod.manifest ?? mod.default;

  if (!candidate) {
    throw new Error(`no default or named \`manifest\` export from ${specifier}`);
  }

  const parsed = ManifestShapeZ.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`invalid manifest from ${specifier}: ${parsed.error.issues.map(i => i.message).join('; ')}`);
  }

  return candidate as PluginManifest;
}

async function resolveSkills(manifest: PluginManifest, env: { orgId: string; env: Readonly<Record<string, string | undefined>> }): Promise<AnySkill[]> {
  if (manifest.skills) {
    return manifest.skills;
  }
  if (manifest.register) {
    return Promise.resolve(manifest.register(env));
  }
  return [];
}
