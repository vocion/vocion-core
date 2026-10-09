/**
 * What Notification settings → Your day shows about listening
 * (docs/guides/listen-to-your-brief.md): whether a voice is connected
 * anywhere in the Org, the voices to choose from, and the private feed.
 */

import type { Voice } from '@/libs/voice/provider';
import { voiceProviderForAccount } from '@/services/voice/provider';
import { ensurePersonalProject } from '@/services/workspace/personalProject';
import { podcastFeedOf } from './podcast';

export type ListenAvailability = {
  /** The voice's provider name, or null when none is connected (listening is then quietly off). */
  voice: { label: string; defaultVoice: Voice } | null;
  feed: { createdAt: Date; lastFetchedAt: Date | null } | null;
};

/**
 * Whether the person's briefs can be heard, and their feed.
 * @param userId - The person.
 * @param accountId - Their Org.
 */
export async function listenAvailability(userId: string, accountId: string): Promise<ListenAvailability> {
  const home = await ensurePersonalProject(userId, accountId);
  const voice = await voiceProviderForAccount(home.id, accountId).catch(() => null);
  return { voice: voice ? { label: voice.label, defaultVoice: voice.defaultVoice } : null, feed: await podcastFeedOf(userId, accountId) };
}

/**
 * The voices the Org's account can speak with, the default first.
 * @param userId - The person asking.
 * @param accountId - Their Org.
 */
export async function voicesFor(userId: string, accountId: string): Promise<{ voices: Voice[]; defaultVoice: Voice | null; reason: string | null }> {
  const home = await ensurePersonalProject(userId, accountId);
  const voice = await voiceProviderForAccount(home.id, accountId).catch(() => null);
  if (!voice) {
    return { voices: [], defaultVoice: null, reason: 'No voice is connected for this Org.' };
  }
  const list = await voice.listVoices();
  const voices = list.ok ? list.voices : [];
  const all = voices.some(v => v.id === voice.defaultVoice.id) ? voices : [voice.defaultVoice, ...voices];
  return { voices: all, defaultVoice: voice.defaultVoice, reason: list.ok ? null : list.reason };
}
