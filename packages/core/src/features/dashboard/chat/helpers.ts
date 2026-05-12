/**
 * Shared helpers for the chat surface (Phase C extraction).
 *
 * Most callers want the source-color/label maps + the elapsed-timer
 * hook + the agent registry. Document helpers (getDisplayTitle,
 * getCleanBlurb, renderWithCitations) live in `./documents.ts` to
 * keep this file tight.
 */

import type { AgentOption } from './types';
import { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Source colors + labels                                              */
/* ------------------------------------------------------------------ */

export const sourceColors: Record<string, string> = {
  hubspot: '#FF7A59',
  google_drive: '#4285F4',
  google_drive_native: '#4285F4',
  gmail: '#EA4335',
  zoom: '#2D8CFF',
  slack: '#4A154B',
  salesforce: '#00A1E0',
  google_calendar: '#0F9D58',
  jira: '#0052CC',
  notion: '#000000',
  confluence: '#172B4D',
  github: '#181717',
  zendesk: '#03363D',
  linear: '#5E6AD2',
};

export const sourceLabels: Record<string, string> = {
  hubspot: 'HubSpot',
  google_drive: 'Drive',
  google_drive_native: 'Drive',
  gmail: 'Gmail',
  zoom: 'Zoom',
  slack: 'Slack',
  salesforce: 'Salesforce',
  google_calendar: 'Calendar',
  jira: 'Jira',
  notion: 'Notion',
  confluence: 'Confluence',
  github: 'GitHub',
  zendesk: 'Zendesk',
  linear: 'Linear',
};

/* ------------------------------------------------------------------ */
/* Elapsed-time hook (used by the streaming + thinking panels)        */
/* ------------------------------------------------------------------ */

export function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setSeconds(0); // eslint-disable-line react-hooks/set-state-in-effect -- reset timer on stop
      return;
    }
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setSeconds(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  return seconds;
}

/* ------------------------------------------------------------------ */
/* Agent registry (hardcoded today; Phase C+1 wires the DB-driven list) */
/* ------------------------------------------------------------------ */

export const AGENTS: AgentOption[] = [
  {
    slug: 'sales-assistant',
    name: 'Sales Assistant',
    icon: 'bot',
    placeholder: 'Ask the Sales Assistant about your pipeline, recent calls, or open deals…',
  },
  {
    slug: '__search__',
    name: 'Search Only',
    icon: 'search',
    placeholder: 'Search across your connected systems...',
  },
];
