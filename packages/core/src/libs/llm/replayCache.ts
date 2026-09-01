/**
 * File-backed LangChain cache powering record/replay for chat models.
 *
 * record - miss returns null (provider is called), and LangChain then
 *          hands us the generations to persist via update().
 * replay - miss returns the canned fallback generation, so the provider
 *          is NEVER called: lookup always "hits."
 */
import { BaseCache } from '@langchain/core/caches';
import { AIMessage } from '@langchain/core/messages';
import { hashKey, llmMode, readEntry, REPLAY_FALLBACK_TEXT, writeEntry } from './replay';

type StoredGeneration = { text: string };

export class ReplayFileCache extends BaseCache<any> {
  async lookup(prompt: string, llmKey: string): Promise<any[] | null> {
    const key = hashKey(prompt, llmKey);
    const stored = readEntry<StoredGeneration[]>('chat', key);
    if (stored) {
      return stored.map(g => ({
        text: g.text,
        message: new AIMessage(g.text),
      }));
    }
    if (llmMode() === 'replay') {
      return [{ text: REPLAY_FALLBACK_TEXT, message: new AIMessage(REPLAY_FALLBACK_TEXT) }];
    }
    return null;
  }

  async update(prompt: string, llmKey: string, value: any[]): Promise<void> {
    if (llmMode() !== 'record') {
      return;
    }
    const key = hashKey(prompt, llmKey);
    const stored: StoredGeneration[] = value.map((g: any) => ({
      text: typeof g.text === 'string' && g.text.length > 0
        ? g.text
        : typeof g.message?.content === 'string' ? g.message.content : JSON.stringify(g.message?.content ?? ''),
    }));
    writeEntry('chat', key, stored);
  }
}

let instance: ReplayFileCache | null = null;
export function getReplayCache(): ReplayFileCache {
  instance ??= new ReplayFileCache();
  return instance;
}
