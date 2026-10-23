import type { LiveFeed } from '@/libs/live/topics';

/**
 * What the Review queue is made of, as live-stream feeds: every ask, every
 * proposed action and every run in the workspace. A bulk decline from chat
 * writes a hundred of them in a burst, and the page re-reads once per burst
 * (`LiveRefresh` gathers them), so the rows and counts move without a reload.
 * Suggested rules have no feed; the interval catches them.
 */
export const REVIEW_LIVE_TOPICS: readonly LiveFeed[] = ['asks', 'cards', 'runs'];

/** The fallback re-read while the stream is down. */
export const REVIEW_LIVE_EVERY_MS = 30_000;
