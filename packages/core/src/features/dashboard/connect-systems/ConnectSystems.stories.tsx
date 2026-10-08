import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { FlowState } from './flow';
import type { ConnectCandidate, ConnectPlan } from '@/libs/connect/systemsPlan';
import { useState } from 'react';
import { ConnectSystemsView } from './ConnectSystemsView';

/**
 * "Connect your systems" — the docked walk-through above the composer, one
 * decision at a time: the one question, each system (Connect, Later, Skip,
 * Stop) with why it is offered and what it unlocks, a key typed inline, the
 * check before moving on, and the summary. Fictional systems throughout; the
 * real ones come from the platform and connector registries.
 */

const CRM: ConnectCandidate = {
  connector: 'crm',
  name: 'Northwind CRM',
  score: 160,
  recommended: true,
  evidence: [{ kind: 'named' }, { kind: 'app', app: 'gtm', appName: 'GTM', needed: true }],
  method: { kind: 'login', startHref: '/api/connect/crm/start?connector=crm', providerLabel: 'Northwind CRM', settingsAfterLogin: [] },
  unlocks: [{ app: 'gtm', appName: 'GTM', href: '/dashboard/apps/gtm', added: true, features: ['Pipeline review', 'Deal follow-ups'] }],
};
const TRACKER: ConnectCandidate = {
  connector: 'tracker',
  name: 'Tracker',
  score: 40,
  recommended: true,
  evidence: [{ kind: 'mail', domain: 'northwind-traders.org' }],
  method: { kind: 'key', credentialLabel: 'API token', credentialFields: [{ name: 'apiKey', label: 'API token', secret: true, optional: false, hint: '' }], configFields: [{ key: 'site', label: 'Site URL', type: 'url', required: true, placeholder: 'https://northwind.tracker.example' }], getItAt: { url: 'https://tracker.example/settings/tokens', steps: ['Create token', 'Copy it'] } },
  unlocks: [],
};
const WIKI: ConnectCandidate = { ...TRACKER, connector: 'wiki', name: 'Wiki', score: 20, recommended: false, evidence: [{ kind: 'org', workspaces: 2 }] };

const PLAN: ConnectPlan = { candidates: [CRM, TRACKER, WIKI], connected: [], question: { question: 'Which of these do you use?', options: ['crm', 'tracker', 'wiki'] }, scope: null, refused: null };
const walk = (index: number, step: Extract<FlowState, { phase: 'walk' }>['step']): FlowState => ({ phase: 'walk', plan: PLAN, queue: [CRM, TRACKER, WIKI], index, step, outcomes: index > 0 ? { crm: 'connected' } : {}, previews: index > 0 ? { crm: 'Found 1,284 deals' } : {} });

function Docked({ state }: { state: FlowState }) {
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string | number | boolean | string[]>>({});
  return (
    <div style={{ width: 720 }} className="bg-background p-4">
      <ConnectSystemsView
        state={state}
        title="Connect your systems"
        onAnswer={() => {}}
        credentialValues={creds}
        onCredentialChange={(n, v) => setCreds(c => ({ ...c, [n]: v }))}
        configValues={config}
        onConfigChange={(k, v) => setConfig(c => ({ ...c, [k]: v }))}
      />
      <div className="rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">Or reply directly…</div>
    </div>
  );
}

const meta = {
  title: 'Chat/ConnectYourSystems',
  component: Docked,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Docked>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Question: Story = { args: { state: { phase: 'question', plan: PLAN } } };
export const StepLogin: Story = { args: { state: walk(0, { at: 'choose' }) } };
export const StepKey: Story = { args: { state: walk(1, { at: 'key' }) } };
export const Checking: Story = { args: { state: walk(1, { at: 'verifying' }) } };
export const DidNotConnect: Story = { args: { state: walk(1, { at: 'failed', reason: 'The login was declined at the vendor.' }) } };
export const Summary: Story = {
  args: { state: { phase: 'summary', plan: PLAN, queue: [CRM, TRACKER, WIKI], outcomes: { crm: 'connected', tracker: 'connected', wiki: 'later' }, previews: { crm: 'Found 1,284 deals', tracker: 'Found 312 documents' } } },
};
export const NothingLeft: Story = { args: { state: { phase: 'nothing', plan: { ...PLAN, candidates: [], connected: [{ connector: 'crm', name: 'Northwind CRM' }] } } } };
