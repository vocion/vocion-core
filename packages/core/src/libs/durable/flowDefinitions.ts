import type { Flow } from './flow';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { fromRepoRoot } from '@/libs/repo-root';
import { PLUGINS_REL } from '@/libs/workspace/plugins';
import { FlowSchema } from './flow';

/**
 * A flow a plugin ships, by reference `<plugin>/<name>`: the file
 * `templates/plugins/<plugin>/workflows/<name>.yaml`, validated. Read at start
 * (as plugin pages are read from the plugin at runtime) and snapshotted into
 * the run, so a run keeps the definition it started with across deploys.
 * @param ref - `<plugin>/<name>`, e.g. `software-factory/request`.
 */
export function loadFlow(ref: string): Flow {
  const [plugin, name] = ref.split('/');
  if (!plugin || !name || !/^[\w-]+$/.test(plugin) || !/^[\w-]+$/.test(name)) {
    throw new Error(`a flow is named <plugin>/<name>; got "${ref}"`);
  }
  const file = join(fromRepoRoot(PLUGINS_REL), plugin, 'workflows', `${name}.yaml`);
  if (!existsSync(file)) {
    throw new Error(`no flow ${ref} (${file})`);
  }
  return FlowSchema.parse(parseYaml(readFileSync(file, 'utf8')));
}
