import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { JevDecisionHealth, JevOutcomes } from '@/services/routing/health';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { JevHealth } from './JevHealth';

/**
 * Is Jev live? on Observability → Routing (ADR 0006, health). Invented counts.
 */

const zero = { used: 0, unsure: 0, auth: 0, rate_limited: 0, http_error: 0, timeout: 0, unreachable: 0, bad_response: 0, breaker: 0, config: 0, skipped: 0 };
const h = (type: JevDecisionHealth['type'], o: Partial<JevDecisionHealth> & { by?: Partial<typeof zero> }): JevDecisionHealth => ({
  type,
  decisions: 0,
  asked: 0,
  answered: 0,
  used: 0,
  failed: 0,
  byOutcome: { ...zero, ...o.by },
  latencyMs: { p50: null, p95: null },
  lastAnsweredAt: null,
  lastFailure: null,
  versions: [],
  status: 'idle',
  sampled: false,
  ...o,
});

const LIVE: JevDecisionHealth[] = [
  h('factory', { decisions: 14, asked: 14, answered: 13, used: 11, failed: 1, by: { used: 11, unsure: 2, timeout: 1 }, latencyMs: { p50: 118, p95: 240 }, lastAnsweredAt: '2026-10-24T20:41:00Z', status: 'live' }),
  h('turn', { decisions: 212, asked: 180, answered: 178, used: 190, failed: 2, by: { used: 190, unsure: 18, timeout: 2, skipped: 2 }, latencyMs: { p50: 96, p95: 310 }, lastAnsweredAt: '2026-10-24T20:55:00Z', status: 'live' }),
  h('agent', { decisions: 37, asked: 37, answered: 37, used: 29, by: { used: 29, unsure: 8 }, latencyMs: { p50: 88, p95: 150 }, lastAnsweredAt: '2026-10-24T20:52:00Z', status: 'live' }),
  h('duplicate', { decisions: 6, asked: 6, answered: 6, used: 5, by: { used: 5, unsure: 1 }, latencyMs: { p50: 102, p95: 131 }, lastAnsweredAt: '2026-10-24T19:10:00Z', status: 'live' }),
];

const REJECTED: JevDecisionHealth[] = LIVE.map(x => x.type === 'duplicate'
  ? h('duplicate', { status: 'idle' })
  : { ...x, status: 'failing', failed: x.failed + 4, asked: x.asked + 4, byOutcome: { ...x.byOutcome, auth: 4 }, lastFailure: { outcome: 'auth', reason: 'Jev (typesafe) answered HTTP 401', at: '2026-10-24T21:00:00Z' } });

const OUTCOMES: JevOutcomes = {
  factory: [{ selector: 'jev', runs: 11, prs: 10, qaJudged: 10, qaApproved: 8, merged: 8, reverted: 0, reruns: 1 }, { selector: 'static', runs: 3, prs: 3, qaJudged: 3, qaApproved: 2, merged: 2, reverted: 0, reruns: 1 }],
  agent: [{ decidedBy: 'jev', firstMessages: 29, anotherAgentLater: 3 }, { decidedBy: 'model', firstMessages: 8, anotherAgentLater: 2 }],
  duplicate: [{ judge: 'jev', linked: 3, undone: 0 }, { judge: 'exact', linked: 1, undone: 0 }],
};

function Page(props: { health: JevDecisionHealth[]; outcomes: JevOutcomes }) {
  return (
    <div className="dark min-h-screen w-[1100px] bg-background p-8 text-foreground">
      <div className="mb-3 px-2 text-[15px] font-semibold">Routing</div>
      <p className="mb-4 px-2 text-sm text-muted-foreground">Dynamic routing is on, on the instance key (…10dd). Factory engines are on the Engines page.</p>
      <NextIntlClientProvider locale="en" messages={messages}>
        <JevHealth health={props.health} outcomes={props.outcomes} canCheck />
      </NextIntlClientProvider>
    </div>
  );
}

const meta: Meta<typeof Page> = { title: 'Routing/JevHealth', component: Page, parameters: { layout: 'fullscreen' } };
export default meta;
type Story = StoryObj<typeof Page>;

export const Live: Story = { args: { health: LIVE, outcomes: OUTCOMES } };
export const KeyRejected: Story = { args: { health: REJECTED, outcomes: { factory: [], agent: [], duplicate: [] } } };
export const NoCallsYet: Story = { args: { health: LIVE.map(x => h(x.type, {})), outcomes: { factory: [], agent: [], duplicate: [] } } };
