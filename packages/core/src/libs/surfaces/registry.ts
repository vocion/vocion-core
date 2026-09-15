import type { ChatSurfaceAdapter } from './types';
import { slackSurface } from './slack';

/**
 * Chat surface registry — the same Map + register/get/list trio as
 * `libs/sources/registry.ts`. One entry today; Teams would be the second.
 */
const registry = new Map<string, ChatSurfaceAdapter>();

export function registerSurface(adapter: ChatSurfaceAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getSurface(id: string): ChatSurfaceAdapter | undefined {
  return registry.get(id);
}

export function listSurfaces(): ChatSurfaceAdapter[] {
  return Array.from(registry.values());
}

registerSurface(slackSurface);
