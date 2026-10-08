import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { CreatePlan, DraftPlan } from './BlankStart';
import type { FunctionPlan } from '@/libs/workspace/functionPlan';
import type { BlankStartData } from '@/services/apps/AppTemplateService';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import en from '@/locales/en.json';
import { BlankStartCard, BlankStartDialog } from './BlankStart';
import { PlanPreview } from './PlanPreview';

/**
 * Describe your own: the preview of a drafted plan — teams, then agents, then
 * what each owns — with every name editable and every item removable, and the
 * dialog around it (describe → draft → preview → Create). Drafting and
 * creating are stubbed.
 */

const PLAN: FunctionPlan = {
  name: 'Northwind Bookkeeping',
  summary: 'Closes each restaurant client\'s month by the fifth working day, answers payroll questions within a day, and raises every filing deadline a week ahead.',
  reuse: { template: { slug: 'support-org', why: 'Client questions run like a support desk.' }, plugins: [{ slug: 'wiki', why: 'Each client\'s standing rules live on one page.' }] },
  teams: [{
    slug: 'bookkeeping',
    name: 'Northwind Bookkeeping',
    description: 'Monthly closes and payroll questions for restaurant clients.',
    goal: 'Every client\'s month closed by the fifth working day.',
    lead: 'controller',
    measures: [
      { key: 'closes_on_time', label: 'Closes done by day five', dimension: 'outcome', target: 12, baseline: 0, unit: 'closes', window: '30d', direction: 'higher', source: { kind: 'agent-reported', counts: 'closesOnTime' } },
      { key: 'answers_sent', label: 'Client answers a person sent', dimension: 'quality', target: 20, baseline: 0, window: '30d', direction: 'higher', source: { kind: 'human-confirmed', actions: ['gmail.send'] } },
    ],
  }],
  agents: [
    { slug: 'controller', name: 'Controller', team: 'bookkeeping', role: 'Owns each client\'s close and the trail behind it.', goal: 'Closes on time with numbers that tie.', source: { kind: 'catalog', slug: 'controller', why: 'The catalog controller closes periods and leaves a trail.' }, dailyCents: 300 },
    { slug: 'payroll-desk', name: 'Payroll desk', team: 'bookkeeping', role: 'Answers client payroll questions with a draft a person sends.', goal: 'Every payroll question answered within a day.', source: { kind: 'new', systemPrompt: 'You draft answers to payroll questions; a person sends every reply.' }, dailyCents: 150 },
    { slug: 'deadline-watch', name: 'Deadline watch', team: 'bookkeeping', role: 'Raises each filing deadline a week ahead.', goal: 'No client misses a deadline.', source: { kind: 'new', systemPrompt: 'You keep the filing calendar and raise each deadline a week ahead.' }, dailyCents: 100 },
  ],
  missions: [
    { slug: 'close-by-day-five', name: 'Every month closed by day five', agent: 'controller', goal: 'Each month closed and reconciled by the fifth working day.', successCriteria: ['A reconciliation on every close'], schedule: '0 14 1-7 * 1-5' },
    { slug: 'no-missed-deadlines', name: 'No missed filing deadlines', agent: 'deadline-watch', goal: 'Every deadline raised a week ahead.', successCriteria: ['An ask a week before each deadline'], schedule: '0 13 * * 1' },
  ],
  automations: [
    { slug: 'monday-deadline-sweep', name: 'Monday deadline sweep', agent: 'deadline-watch', description: 'Checks the coming fortnight.', when: { schedule: '0 13 * * 1' }, checkMission: 'no-missed-deadlines', prompt: 'List the deadlines in the next fourteen days.' },
  ],
  trust: [{ action: 'gmail.send', rung: 'execute-with-approval', autoApproveAbove: 0.99, risk: 'medium', why: 'Every reply to a client is a person\'s.' }],
};

const BLANK: BlankStartData = {
  label: 'Describe your own',
  description: 'Say what the function does in your own words; a plan is drafted from it for you to edit before anything is created.',
  describe: { question: 'What should this function do, and for whom?', placeholder: 'A two-person bookkeeping practice for restaurants…', help: 'A few sentences in your own words.', maxLength: 1500 },
  interview: [
    { key: 'company', question: 'What is the company called?', placeholder: 'Northwind Traders', help: null, defaultValue: 'Northwind Traders', maxLength: 80 },
    { key: 'goal', question: 'What should it deliver this quarter?', placeholder: null, help: 'One sentence.', defaultValue: null, maxLength: 200 },
  ],
};

const drafts: DraftPlan = async () => ({ ok: true, plan: PLAN });
const creates: CreatePlan = async plan => ({
  ok: true,
  receipt: {
    app: 'company',
    template: 'blank',
    name: plan.name,
    sha: 'local-7c1e09a',
    runId: 412,
    files: { created: ['teams/bookkeeping.yaml'], unchanged: [], kept: [] },
    pluginsAdded: ['company', 'wiki'],
    trustRulesAdded: ['gmail.send'],
    leadSet: 'controller',
    accountableUserSet: 'lili.chen@northwind.example',
    contents: { teams: ['bookkeeping'], agents: plan.agents.map(a => a.slug), missions: plan.missions.map(m => m.slug), automations: plan.automations.map(a => a.slug), skills: [], trustRules: ['gmail.send'], plugins: ['wiki'], budgets: plan.agents.map(a => a.slug) },
    applied: { errors: [], teams: { created: 1, updated: 0, unchanged: 0 }, agents: { created: plan.agents.length, updated: 0, unchanged: 0 }, missions: { created: plan.missions.length, updated: 0, unchanged: 0 }, automations: { created: 1, updated: 0, unchanged: 0 } },
    links: { teamReport: '/dashboard/team-report', chat: '/dashboard/chat?agent=controller' },
  },
});
const budgetSpent: DraftPlan = async () => ({ ok: false, message: 'This workspace\'s spend budget is spent for the period, so no draft was written.' });

/** The preview, editable — rename anything, remove what you do not want. */
function EditablePreview() {
  const [plan, setPlan] = useState(PLAN);
  return <div className="max-w-2xl"><PlanPreview plan={plan} onChange={setPlan} /></div>;
}

const meta: Meta<typeof EditablePreview> = {
  title: 'Apps/PlanPreview',
  component: EditablePreview,
  parameters: { layout: 'padded', nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/apps/company' } } },
  decorators: [Story => <NextIntlClientProvider locale="en" messages={en}><Story /></NextIntlClientProvider>],
};

export default meta;

type Story = StoryObj<typeof EditablePreview>;

/** A drafted plan: one hired catalog role, two new seats, the plugin it turns on and the template it is closest to. */
export const Preview: Story = {};

/** The card beside the templates. */
export const Card: StoryObj<typeof BlankStartCard> = {
  render: () => <div className="max-w-sm"><BlankStartCard blank={BLANK} action={<span className="text-xs text-muted-foreground">action</span>} /></div>,
};

/** The whole dialog: describe, draft, preview, Create. */
export const Dialog: StoryObj<typeof BlankStartDialog> = {
  render: () => <BlankStartDialog blank={BLANK} onClose={() => {}} draft={drafts} create={creates} />,
};

/** The budget is spent: the draft says so in words, and nothing was called. */
export const DialogBudgetSpent: StoryObj<typeof BlankStartDialog> = {
  render: () => <BlankStartDialog blank={BLANK} onClose={() => {}} draft={budgetSpent} create={creates} />,
};
