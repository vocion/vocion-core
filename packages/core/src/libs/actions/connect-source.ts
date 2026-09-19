/**
 * `connection.connect_source` — the review-queue item a run with no person in
 * it files when it hits a connector nobody has connected.
 *
 * Chat can serve a card, because there is somebody looking at it. A schedule,
 * a workflow step and an API caller cannot, and what they did instead was
 * quietly answer short: the brief came out thinner, nothing said why, and the
 * next run did the same thing. The gap has to land somewhere a person will see
 * it, and the review queue is the surface that already exists for "the agent
 * needs a decision from you".
 *
 * `external: true` and the queue's own gate mean this is never executed
 * automatically. Approving it is a person saying "yes, connect that" — the
 * actual connecting is a credential they supply, which is why `execute`
 * records the decision and points at the connectors page rather than trying to
 * bind anything itself. An action must never be the thing that holds a
 * credential.
 */

import type { Action } from './types';
import { z } from 'zod';

const connectSourceInput = z.object({
  /** The connector the run could not reach. */
  connector: z.string().min(1).max(64),
  /** Human label, so the card reads as a system rather than a slug. */
  connectorName: z.string().min(1).max(120),
  /** What the run was trying to do — core's words, never the model's. */
  reason: z.string().min(1).max(500),
  /** The tool that hit the gap, so the queue can say how specific the need was. */
  tool: z.string().max(120).optional(),
  /** Whose connection it would be. */
  scope: z.enum(['user', 'workspace']),
  /** Where the gap was met, so "this keeps happening on the nightly run" is visible. */
  surface: z.enum(['schedule', 'workflow', 'api']),
});

export const connectSourceAction: Action<typeof connectSourceInput> = {
  id: 'connection.connect_source',
  name: 'Connect a source the agent needed',
  description: 'A run with nobody watching hit a connector this workspace has not connected.',
  grant: 'connect_source',
  external: true,
  // One item per connector, however many runs hit it. A nightly brief that
  // needs HubSpot needs it every night, and thirty identical queue rows would
  // bury the queue rather than describe the problem — the pending item is
  // updated in place and its occurrence is the signal.
  dedupKeyFor: input => `connection.connect_source:${input.connector}`,
  inputSchema: connectSourceInput,

  async reviewCard(_ctx, input) {
    const where = input.surface === 'schedule'
      ? 'a scheduled run'
      : input.surface === 'workflow' ? 'a workflow step' : 'an API caller';
    return {
      title: `Connect ${input.connectorName}`,
      system: input.connectorName,
      object: {
        title: input.connectorName,
        subtitle: input.scope === 'user' ? 'Connects for one person' : 'Connects for the whole workspace',
        section: 'Connectors',
      },
      recommendation: {
        headline: `${input.connectorName} is not connected, so ${where} answered without it.`,
        detail: input.reason,
      },
      fields: [
        { label: 'Connector', value: input.connectorName },
        { label: 'Where', value: where },
        { label: 'Scope', value: input.scope === 'user' ? 'One person' : 'The workspace' },
        ...(input.tool ? [{ label: 'Needed for', value: input.tool }] : []),
      ],
      links: [{ label: 'Connectors', href: '/dashboard/connectors' }],
      verbs: { approve: 'I\'ll connect it', reject: 'Leave it' },
      summary: input.reason,
      nextAction: `Connect ${input.connectorName} under Connectors. The next run picks it up.`,
    };
  },

  async execute() {
    // Deliberately inert. Approving records that somebody took it on; the
    // credential itself is supplied under Connectors, where the vault is. An
    // action that tried to hold a credential would be the wrong place for one.
    return { ok: true as const, detail: 'Noted. Connect it under Connectors and the next run picks it up.' };
  },
};
