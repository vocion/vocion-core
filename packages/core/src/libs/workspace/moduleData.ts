import type { PluginInfo } from './plugins';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { PageManifestSchema } from './pageFields';
import { ObjectTypeManifestSchema } from './schemas';

/**
 * Validate module contracts before installation or workspace composition.
 * Exports describe interoperability, never permission to read another workspace.
 * @param modules - Dependency-ordered modules and their filesystem inventory.
 */
export function validateModuleData(modules: readonly PluginInfo[]): void {
  const bySlug = new Map(modules.map(bundle => [bundle.manifest.slug, bundle]));
  const owners = new Map<string, string>();
  for (const bundle of modules) {
    const { manifest, contents } = bundle;
    for (const type of contents.objectTypes) {
      const owner = owners.get(type);
      if (owner) {
        throw new Error(`object type "${type}" is shipped by both plugin "${owner}" and plugin "${manifest.slug}" — a slug belongs to one plugin`);
      }
      owners.set(type, manifest.slug);
    }
  }
  for (const bundle of modules) {
    const { manifest, contents } = bundle;
    const contract = manifest.data;
    if (!contract) {
      continue;
    }
    const fail = (message: string): never => {
      throw new Error(`module "${manifest.slug}" data contract: ${message}`);
    };
    const available = new Set(contents.objectTypes);
    if (new Set(contract.exports).size !== contract.exports.length) {
      fail('duplicate object exports');
    }
    for (const type of contents.objectTypes) {
      try {
        const yaml = join(bundle.sourcePath, 'objects', type, 'type.yaml');
        const file = existsSync(yaml) ? yaml : join(bundle.sourcePath, 'objects', type, 'type.yml');
        const definition = ObjectTypeManifestSchema.parse(parse(readFileSync(file, 'utf8')));
        if (definition.slug !== type) {
          fail(`object definition "${type}" declares a different slug`);
        }
      } catch (error) {
        fail(`invalid object definition "${type}": ${String(error)}`);
      }
    }
    for (const type of contract.exports) {
      if (!available.has(type)) {
        fail(`cannot export "${type}": no owned object definition`);
      }
    }
    for (const imported of contract.imports) {
      if (!manifest.depends.includes(imported.module)) {
        fail(`import from "${imported.module}" requires an explicit depends entry`);
      }
      const provider = bySlug.get(imported.module);
      for (const type of imported.objects) {
        if (!provider?.manifest.data?.exports.includes(type)) {
          fail(`"${imported.module}" does not export "${type}"`);
        }
        available.add(type);
      }
    }
    const pages = new Set<string>();
    for (const collection of contract.collections) {
      if (pages.has(collection.page)) {
        fail(`duplicate collection "${collection.page}"`);
      }
      pages.add(collection.page);
      if (!available.has(collection.objectType)) {
        fail(`collection "${collection.page}" uses "${collection.objectType}" without owning or importing it`);
      }
      if (!contents.pages.includes(collection.page)) {
        fail(`collection page "${collection.page}" is missing`);
      }
      let page;
      try {
        const yaml = join(bundle.sourcePath, 'pages', `${collection.page}.yaml`);
        const file = existsSync(yaml) ? yaml : join(bundle.sourcePath, 'pages', `${collection.page}.yml`);
        page = PageManifestSchema.parse(parse(readFileSync(file, 'utf8')));
      } catch (error) {
        fail(`invalid collection page "${collection.page}": ${String(error)}`);
      }
      if (page?.slug !== collection.page || page.archetype !== 'list' || page.source?.kind !== 'objects' || page.source.objectType !== collection.objectType) {
        fail(`collection "${collection.page}" must be a list over "${collection.objectType}"`);
      }
    }
  }
}
