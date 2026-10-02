import type { DurableDefinition } from './types';

const definitions = new Map<string, DurableDefinition<any, any>>();

/**
 * Register a definition so the executor can run it. Idempotent by name; a
 * second definition under a taken name is a programming error.
 * @param definition - The definition.
 */
export function defineDurable<I, O>(definition: DurableDefinition<I, O>): DurableDefinition<I, O> {
  const existing = definitions.get(definition.name);
  if (existing && existing !== definition) {
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
