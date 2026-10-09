import type { ChatMessageRef } from './provider';
import { parseDiscordPermalink } from './providers/discord';
import { parseSlackPermalink } from './providers/slack';

/**
 * A message link read back into ids by whichever chat writes links that way, with the chat it
 * belongs to — pure and token-free, so an action's dedup key, card and precheck can read it
 * without loading the provider (`./provider.ts`).
 * @param url - A permalink to a message.
 */
export function parseAnyChatPermalink(url: string): ChatMessageRef | null {
  const slack = parseSlackPermalink(url);
  return slack ? { ...slack, kind: 'slack' } : parseDiscordPermalink(url);
}
