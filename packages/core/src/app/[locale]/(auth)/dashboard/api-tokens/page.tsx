import { redirect } from 'next/navigation';

/**
 * API credentials moved into the Developers page (nav sweep, 2026-09-15):
 * tokens, the MCP/REST endpoints and the docs are one job — "connect
 * something to this workspace" — so they share one page under Organization.
 *
 * This page stays so existing links and bookmarks keep working.
 */
export default function ApiTokensPage() {
  redirect('/dashboard/developers');
}
