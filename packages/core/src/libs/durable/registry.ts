import type { DurableDefinition } from './types';

// Under Node 20, tsx can evaluate a module twice (the static graph, then a
// dynamic `import()` of the same file) against this one registry, so a second
// copy of the same definition is the same definition (the v0.6.0 deploy's
// applier failed every schedule on it). Next's route bundles each carry their
// own registry, so they never meet here.
const definitions = new Map<string, DurableDefinition<any, any>>();

/**
 * Register a definition so the executor can run it. Idempotent by name; a
 * different definition under a taken name is a programming error.
 * @param definition - The definition.
 */
export function defineDurable<I, O>(definition: DurableDefinition<I, O>): DurableDefinition<I, O> {
  const existing = definitions.get(definition.name);
  if (existing && existing !== definition) {
    if (String(existing.run) === String(definition.run)) {
      return existing;
    }
    throw new Error(`durable definition "${definition.name}" is already registered`);
  }
  definitions.set(definition.name, definition);
  return definition;
}

/**
 * A registered definition, or throws naming it.
 * @param name - The definition's name.
 */
export function definitionNamed(name: string): DurableDefinition<any, any> {
  const d = definitions.get(name);
  if (!d) {
    throw new Error(`no durable definition named "${name}"`);
  }
  return d;
}

export function allDefinitions(): DurableDefinition<any, any>[] {
  return [...definitions.values()];
}

/**
 * The run id for a record: one owner per record, scoped by workspace.
 * @param orgId - The workspace.
 * @param kind - What the run is for (a definition's short name).
 * @param key - The record's key.
 */
export function durableIdFor(orgId: string, kind: string, key: string | number): string {
  return `${orgId}:${kind}:${key}`;
}
