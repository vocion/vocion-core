/**
 * The app home's words and links — what the client half of the home needs
 * (the ask bar, the tiles, the greeting), kept apart from the figures
 * (`appHome.ts`) so the browser never loads the page-field machinery.
 * Pure; tested in `appHome.test.ts`.
 */

import type { AppHome, AppLaunchTile } from './schemas';

/**
 * "Good morning" by the hour of the person's day.
 * @param hour - 0–23 in the workspace's zone.
 */
export function greetingPart(hour: number): 'morning' | 'afternoon' | 'evening' {
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/**
 * The first name a greeting uses: the first word of the person's name, else
 * the part of their address before the @, else nothing.
 * @param person - The person.
 * @param person.name - Their name.
 * @param person.email - Their address.
 */
export function firstNameOf(person: { name?: string | null; email?: string | null }): string | null {
  const name = person.name?.trim().split(/\s+/)[0];
  if (name) {
    return name;
  }
  const local = person.email?.split('@')[0]?.split(/[._+-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : null;
}

/**
 * The tile an empty app shows alone: the one marked `first`, else the first.
 * @param home - The app's home.
 */
export function firstTile(home: Pick<AppHome, 'launch'>): AppLaunchTile {
  return home.launch.find(t => t.first) ?? home.launch[0]!;
}

/**
 * Where a tile goes. A tile that asks or prompts opens Chat with the words
 * (the app the person is in routes the turn to its lead); a page opens; a
 * workflow opens its run form.
 * @param tile - The tile.
 */
export function tileHref(tile: Pick<AppLaunchTile, 'ask' | 'prompt' | 'href' | 'workflow'>): string {
  if (tile.href) {
    return tile.href;
  }
  if (tile.workflow) {
    return `/dashboard/workflows/${encodeURIComponent(tile.workflow)}/run`;
  }
  if (tile.ask) {
    return `/dashboard/chat?ask=${encodeURIComponent(tile.ask)}`;
  }
  return `/dashboard/chat?new=1&prompt=${encodeURIComponent(tile.prompt ?? '')}`;
}

/**
 * Chat with the person's words sent as a new conversation's first message.
 * @param text - What they typed.
 */
export function askHref(text: string): string {
  return `/dashboard/chat?ask=${encodeURIComponent(text.trim())}`;
}
