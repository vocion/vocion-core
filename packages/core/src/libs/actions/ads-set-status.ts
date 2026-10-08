/**
 * `ads.set_status` — pause or resume a campaign or ad set on the connected ad
 * platform.
 *
 * The one write the ads family has, because it is the one an agent watching
 * spend most needs: an ad set burning budget with no clicks is paused now,
 * not after the next meeting. Reversible: the state it left is recorded, and
 * Undo puts it back. A connection that may only read (a LinkedIn login asks
 * for `r_ads` alone) is refused before anything is queued, with the reason.
 * Budgets, bids, audiences and creatives are not touched here, ever.
 */

import type { Action } from './types';
import { z } from 'zod';

export const ADS_SET_STATUS_ACTION_ID = 'ads.set_status';

const setStatusInput = z.object({
  level: z.enum(['campaign', 'ad_set']).describe('campaign, or ad_set (LinkedIn calls an ad set a campaign).'),
  id: z.string().min(1).max(64).describe('The campaign or ad set id, from ads_campaigns.'),
  state: z.enum(['paused', 'active']).describe('paused to stop delivery, active to resume it.'),
  reason: z.string().max(400).optional().describe('Why, in a sentence a person reads on the card: "spent $412 in 7 days with 0 conversions".'),
  source: z.string().optional().describe('The ads source, when the workspace has more than one.'),
});

type Input = z.infer<typeof setStatusInput>;

async function providerFor(orgId: string, input: Pick<Input, 'source'>) {
  const { adsProviderFor } = await import('@/services/ads/provider');
  return adsProviderFor(orgId, { sourceSlug: input.source ?? null });
}

const verb = (state: 'paused' | 'active') => (state === 'paused' ? 'Pause' : 'Resume');

export const adsSetStatusAction: Action<typeof setStatusInput> = {
  id: ADS_SET_STATUS_ACTION_ID,
  name: 'Pause or resume an ad campaign',
  description: 'Pause or resume a campaign or ad set on the connected ad platform (LinkedIn Ads or Meta Ads). Undo puts it back the way it was. Budgets, bids and audiences are never changed.',
  inputSchema: setStatusInput,
  grant: 'manage_ads',
  external: true,
  // One pending decision per entity and target state.
  dedupKeyFor: input => `${ADS_SET_STATUS_ACTION_ID}:${input.source ?? ''}:${input.level}:${input.id.trim()}:${input.state}`,
  async precheck(ctx, input) {
    try {
      const provider = await providerFor(ctx.orgId, input);
      if (!provider.setState) {
        return `This ${provider.vendor} connection can only read, so it cannot ${verb(input.state).toLowerCase()} anything. Reconnect it with write access to ${input.state === 'paused' ? 'pause' : 'resume'} from Vocion, or do it in ${provider.vendor}.`;
      }
    } catch (err) {
      return (err as Error).message;
    }
    return undefined;
  },
  async reviewCard(ctx, input) {
    let name = input.id;
    let vendor = 'Ad platform';
    let link: string | null = null;
    let current: string | null = null;
    try {
      const provider = await providerFor(ctx.orgId, input);
      vendor = provider.vendor;
      const entity = await provider.read(input.level, input.id);
      name = entity.name;
      link = entity.url;
      current = entity.status;
    } catch {
      // The card still reads with the id alone.
    }
    const levelWord = input.level === 'campaign' ? 'campaign' : 'ad set';
    return {
      title: `${verb(input.state)} ${levelWord} ${name}`,
      system: vendor,
      headline: `${verb(input.state)} the ${levelWord} on ${vendor} now; Undo puts it back.`,
      badges: [{ label: vendor }, { label: 'Undo puts it back' }],
      fields: [
        { label: input.level === 'campaign' ? 'Campaign' : 'Ad set', value: name, ...(link ? { href: link } : {}) },
        ...(current ? [{ label: 'Now', value: current }] : []),
        { label: 'After', value: input.state === 'paused' ? 'Paused' : 'Active' },
        ...(input.reason ? [{ label: 'Because', value: input.reason }] : []),
      ],
      nextAction: input.state === 'paused' ? 'Approving stops its delivery now.' : 'Approving starts its delivery again now.',
      verbs: { approve: verb(input.state), reject: 'Leave it' },
    };
  },
  async execute(ctx, input) {
    const provider = await providerFor(ctx.orgId, input);
    if (!provider.setState) {
      throw new Error(`This ${provider.vendor} connection can only read.`);
    }
    const before = await provider.read(input.level, input.id);
    const after = await provider.setState(input.level, input.id, input.state);
    return {
      changed: before.state !== after.state,
      level: input.level,
      id: input.id,
      name: after.name,
      from: before.state,
      fromStatus: before.status,
      to: after.state,
      url: after.url,
      line: `${input.state === 'paused' ? 'Paused' : 'Resumed'} ${after.name} on ${provider.vendor}${input.reason ? `: ${input.reason}` : ''}`,
    };
  },
  async undo(ctx, input, result) {
    const from = result?.from;
    if (from !== 'active' && from !== 'paused') {
      return { restored: false, note: `It was ${typeof result?.fromStatus === 'string' ? result.fromStatus : 'in another state'} before, which Undo cannot set from here; a person sets it in the ad manager.` };
    }
    const provider = await providerFor(ctx.orgId, input);
    if (!provider.setState) {
      return { restored: false, note: `This ${provider.vendor} connection can no longer write; a person sets it back in ${provider.vendor}.` };
    }
    const back = await provider.setState(input.level, input.id, from);
    return { restored: true, id: input.id, to: back.state, line: `Set ${back.name} back to ${back.status}.` };
  },
};
