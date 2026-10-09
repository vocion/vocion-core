'use client';

import type { AgentOption } from './types';
import { createContext, use } from 'react';

/**
 * The surface's agents, for the pieces of a turn that draw a teammate's avatar
 * (a delegated step, a team answer) without each one being handed the roster.
 */
const ChatAgentsContext = createContext<readonly AgentOption[]>([]);

export const ChatAgentsProvider = ChatAgentsContext.Provider;

/** The surface's agents; empty outside a transcript. */
export function useChatAgents(): readonly AgentOption[] {
  return use(ChatAgentsContext);
}
