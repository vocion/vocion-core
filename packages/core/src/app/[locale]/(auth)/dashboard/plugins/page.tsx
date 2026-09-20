import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * /dashboard/plugins → /dashboard/marketplace/plugins (308).
 *
 * The plugin catalogue and the agent catalogue were two pages asking the same
 * question — what could this workspace turn on that it has not — so they are
 * one Marketplace now (Chris, 2026-09-18). A permanent redirect, not a delete:
 * the old path is in pinned nav entries, in chat's "turn a plugin on" answer,
 * and in whatever links people already sent each other. The per-plugin detail
 * page at `/dashboard/plugins/<slug>` stays exactly where it was — the chat's
 * recommend cards link straight to it.
 */
export default function PluginsRedirect(): never {
  permanentRedirect('/dashboard/marketplace/plugins');
}
