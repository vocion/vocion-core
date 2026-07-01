/**
 * Registry of connector-write actions — the mutation counterpart to
 * `libs/sources/registry`. ActionService looks actions up by id; the future
 * dashboard/MCP surfaces list them for a "what can this teammate do" view.
 */

import type { Action } from './types';
import { gmailSendAction } from './gmail-send';
import { hubspotUpdateAction } from './hubspot-update';

const registry = new Map<string, Action>();

export function registerAction(action: Action): void {
  registry.set(action.id, action);
}

export function getAction(id: string): Action | undefined {
  return registry.get(id);
}

export function listActions(): Action[] {
  return Array.from(registry.values());
}

// Built-ins.
registerAction(gmailSendAction);
registerAction(hubspotUpdateAction);
