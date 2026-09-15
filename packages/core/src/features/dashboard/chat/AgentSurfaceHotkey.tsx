'use client';

import type { PaletteEntity } from '@/features/dashboard/palette/paletteGroups';
import { CommandPalette } from '@/features/dashboard/CommandPalette';

/**
 * The keyboard entry point, mounted once by the shell. ⌘K (Ctrl+K) now opens
 * the command palette — pages, agents, conversations and "Ask Vocion: …" in
 * one field (B-034b §3). The rail keeps its own key (⌘J) and every other
 * entry point still goes through `requestAgentSurface()`
 * (agent-chat-surface.md §6); the palette's Ask row calls the same function.
 * @param props
 * @param props.isAdmin - Whether admin-only routes appear in the palette.
 * @param props.agents - The workspace's chat agents, already loaded for the dock.
 */
export function AgentSurfaceHotkey({ isAdmin = false, agents = [] }: { isAdmin?: boolean; agents?: PaletteEntity[] }) {
  return <CommandPalette isAdmin={isAdmin} agents={agents} />;
}
