import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { InstallTemplate } from './TemplatePicker';
import type { AppTemplateCardData, TemplateInstallReceipt } from '@/services/apps/AppTemplateService';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/locales/en.json';
import { InstallReceipt, TemplateCard, TemplateInterview, TemplatePicker } from './TemplatePicker';

/**
 * The Company app's start page: three templates, each a function stood up in
 * one move. An admin picks one, answers two or three questions and presses
 * once; a member sees what each stands up; a workspace applied from git sees
 * the repo path instead of the action. Installs are stubbed.
 */

const contents = (teams: string[], agents: string[], plugins: string[] = []): AppTemplateCardData['contents'] => ({
  teams,
  agents,
  missions: ['first-reply-inside-a-day', 'support-quality-review'],
  automations: ['support-queue-sweep', 'support-quality-friday'],
  skills: [],
  trustRules: ['gmail.send', 'ask.file'],
  plugins,
  budgets: agents,
});

const interview = (third: { key: string; question: string; placeholder: string }): AppTemplateCardData['interview'] => [
  { key: 'company', question: 'What is the company called?', placeholder: 'Northwind Traders', help: null, defaultValue: 'Northwind Traders', maxLength: 80 },
  { key: 'goal', question: 'What should it deliver this quarter?', placeholder: null, help: 'One sentence. It becomes the team\'s goal on the team report.', defaultValue: 'Every customer hears back within one business day.', maxLength: 160 },
  { key: third.key, question: third.question, placeholder: third.placeholder, help: null, defaultValue: null, maxLength: 160 },
];

const TEMPLATES: AppTemplateCardData[] = [
  {
    slug: 'software-company',
    name: 'Software Company',
    icon: 'git-branch',
    description: 'Requests become verified releases, with a leadership team that reads the work against the goal every week.',
    includes: ['The software factory, as it ships — PM, Design, Eng, QA and Release', 'A leadership team that reports weekly against your goal', 'Decisions put to you as asks, never made for you'],
    contents: contents(['leadership'], ['company-chief-of-staff', 'company-analyst', 'customer-voice'], ['software-factory']),
    interview: interview({ key: 'product', question: 'What are you building?', placeholder: 'Scheduling for field-service teams' }),
    installed: true,
  },
  {
    slug: 'marketing-agency',
    name: 'Marketing Agency',
    icon: 'megaphone',
    description: 'Client asks become briefs, briefs become checked work, and every client hears what moved each week.',
    includes: ['The growth loop for briefs, production, quality and measurement', 'A client-services team for intake and weekly reports', 'Nothing reaches a client without a person'],
    contents: contents(['client-services'], ['account-director', 'client-reporter', 'intake-coordinator'], ['growth-loop']),
    interview: interview({ key: 'clients', question: 'Who do you make work for?', placeholder: 'B2B software companies' }),
    installed: false,
  },
  {
    slug: 'support-org',
    name: 'Support Org',
    icon: 'life-buoy',
    description: 'Every ticket triaged, a first reply drafted within a business day, and escalations owned until they close.',
    includes: ['A support desk: a lead, triage, reply drafting and escalations', 'A morning queue sweep and a Friday quality review', 'Every reply to a customer waits for a person'],
    contents: contents(['support'], ['support-lead', 'ticket-triager', 'reply-drafter', 'escalation-specialist']),
    interview: interview({ key: 'product', question: 'What do customers come to you for help with?', placeholder: 'Our scheduling app' }),
    installed: false,
  },
];

const RECEIPT: TemplateInstallReceipt = {
  app: 'company',
  template: 'support-org',
  name: 'Support Org',
  sha: 'local-3f9c2a1',
  files: { created: ['teams/support.yaml', 'agents/support-lead.yaml'], unchanged: [], kept: [] },
  pluginsAdded: ['company'],
  trustRulesAdded: ['gmail.send', 'ask.file'],
  leadSet: 'support-lead',
  accountableUserSet: 'lili.chen@northwind.example',
  contents: TEMPLATES[2]!.contents,
  applied: {
    errors: [],
    teams: { created: 1, updated: 0, unchanged: 0 },
    agents: { created: 4, updated: 0, unchanged: 0 },
    missions: { created: 1, updated: 0, unchanged: 0 },
    automations: { created: 2, updated: 0, unchanged: 0 },
  },
  links: { teamReport: '/dashboard/team-report', chat: '/dashboard/chat?agent=support-lead' },
};

const succeeds: InstallTemplate = async () => ({ ok: true, receipt: { ...RECEIPT, runId: 411 } });

const BLANK = {
  label: 'Describe your own',
  description: 'Not one of these? Say what the function does in your own words; a plan is drafted from it for you to edit before anything is created.',
  describe: { question: 'What should this function do, and for whom?', placeholder: 'A two-person bookkeeping practice for restaurants…', help: null, maxLength: 1500 },
  interview: [{ key: 'company', question: 'What is the company called?', placeholder: null, help: null, defaultValue: 'Northwind Traders', maxLength: 80 }],
};
const needsAnswers: InstallTemplate = async () => ({ ok: false, message: '"What do customers come to you for help with?" needs an answer', problems: { product: 'needs an answer' } });

const meta: Meta<typeof TemplatePicker> = {
  title: 'Apps/TemplatePicker',
  component: TemplatePicker,
  parameters: { layout: 'padded', nextjs: { appDirectory: true, navigation: { pathname: '/dashboard/apps/company' } } },
  // The receipt's links are the locale-aware Link, which reads the intl context.
  decorators: [Story => <NextIntlClientProvider locale="en" messages={en}><Story /></NextIntlClientProvider>],
  args: { appId: 'company', templates: TEMPLATES, blank: BLANK, writable: { ok: true }, canInstall: true, install: succeeds },
};

export default meta;

type Story = StoryObj<typeof TemplatePicker>;

/** An admin, on a workspace this host can write: one move per template. */
export const Admin: Story = {};

/** A member sees what each stands up, and that an admin sets it up. */
export const Member: Story = { args: { canInstall: false } };

/** A workspace applied from git: the reason and the repo path replace the action. */
export const AppliedFromGit: Story = {
  args: { writable: { ok: false, reason: 'This workspace is applied from git, so a template cannot write into it from here. Add the template\'s files to workspace/northwind/ in the workspace repo and deploy.' } },
};

/** One card on its own. */
export const Card: StoryObj<typeof TemplateCard> = {
  render: () => <div className="max-w-sm"><TemplateCard template={TEMPLATES[1]!} action={<span className="text-xs text-muted-foreground">action</span>} /></div>,
};

/** The interview, open. */
export const Interview: StoryObj<typeof TemplateInterview> = {
  render: () => <TemplateInterview template={TEMPLATES[2]!} onClose={() => {}} install={succeeds} />,
};

/** The interview after a question came back unanswered. */
export const InterviewNeedsAnAnswer: StoryObj<typeof TemplateInterview> = {
  render: () => <TemplateInterview template={TEMPLATES[2]!} onClose={() => {}} install={needsAnswers} />,
};

/** What a person reads after the install — with Undo, which puts the whole install back. */
export const Receipt: StoryObj<typeof InstallReceipt> = {
  render: () => <div className="max-w-lg"><InstallReceipt receipt={{ ...RECEIPT, runId: 411 }} undo={async () => null} /></div>,
};

/** Installing again: nothing to change, and a file the person edited kept as they left it. */
export const ReceiptAlreadySetUp: StoryObj<typeof InstallReceipt> = {
  render: () => (
    <div className="max-w-lg">
      <InstallReceipt receipt={{ ...RECEIPT, files: { created: [], unchanged: ['teams/support.yaml'], kept: ['agents/support-lead.yaml'] }, pluginsAdded: [], trustRulesAdded: [], leadSet: null, accountableUserSet: null }} />
    </div>
  ),
};
