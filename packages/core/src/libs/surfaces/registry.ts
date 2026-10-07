import type { ChatSurfaceAdapter } from './types';
import { slackSurface } from './slack';
import { smsSurface } from './sms';

/**
 * Chat surface registry — the same Map + register/get/list trio as
 * `libs/sources/registry.ts`. Slack and text messages (Twilio); Teams would be another.
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
registerSurface(smsSurface);
