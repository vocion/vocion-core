import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { ReviewCardRun } from './ReviewSurface';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/locales/en.json';
import { ReviewSurface } from './ReviewSurface';

/**
 * The outbound message artifact — one shape for every action that puts words
 * in front of someone. A Gmail reply draft, the same draft after its approval
 * was refused for want of access, a Slack post, and the other artifact on the
 * same shell: a multi-touch sequence as a step timeline.
 *
 * The cast is fictional (`libs/fixtures/realDataGuard.ts`).
 */
const meta: Meta<typeof ReviewSurface> = {
  title: 'Review/OutboundMessage',
  component: ReviewSurface,
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <div className="@container mx-auto max-w-5xl">
          <Story />
        </div>
      </NextIntlClientProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof ReviewSurface>;

const CRUMBS = [
  { label: 'Workspace', href: '/dashboard' },
  { label: 'Review', href: '/dashboard/inbox' },
  { label: 'Recommendations', href: '/dashboard/inbox?kind=proposal' },
  { label: 'Draft a reply to Dana Reyes' },
];

/** The 403 Gmail answers a read-only login asked to create a draft — what proposal 8017 showed raw. */
const GMAIL_SCOPE_ERROR = 'Gmail draft failed: 403 { "error": { "code": 403, "message": "Request had insufficient authentication scopes.", "errors": [ { "message": "Insufficient Permission", "domain": "global", "reason": "insufficientPermissions" } ], "status": "PERMISSION_DENIED", "details": [ { "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "domain": "googleapis.com", "metadata": { "service": "gmail.googleapis.com", "method": "caribou.api.proto.MailboxService.CreateDraft" } } ] } }';

const BODY = 'Dana,\n\nSounds good, let\'s get everyone on a call rather than waiting on time with Priya and Owen. I\'ll coordinate with Rowan on our side for availability early next week and send a few slot options to you, Rowan, and Iris. Goal is to confirm the Option A vs. B direction so you have what you need before the board conversation.\n\nDoes Monday or Tuesday work better on your end?';

/**
 * A reply draft as `gmail.send`'s presenter builds it for a threaded reply.
 * @param over
 */
const replyDraft = (over: Partial<ReviewCardRun> = {}): ReviewCardRun => ({
  id: 8017,
  actionId: 'gmail.send',
  status: 'pending',
  invokedBy: 'agent:revenue-lead',
  input: { to: 'Dana Reyes <dana@kestrel.example>', cc: 'Iris Nakamura <iris@kestrel.example>', subject: 'Re: Phase 2 priorities', body: BODY, draft: true, threadId: '18f2c0a9d4e1b7a3' },
  proposal: {
    confidence: 0.8,
    rationale: 'Dana asked on Oct 8 for a joint call to settle Option A vs. B before Kestrel\'s Oct 15 board review, and nobody has answered in two days.',
    evidence: ['https://mail.google.com/mail/u/0/#all/18f2c0a9d4e1b7a3'],
    suggestedDecision: 'approve',
    suggestedDecisionReason: 'Recommended: Draft a reply to Dana Reyes',
  },
  card: {
    title: 'Draft a reply to Dana Reyes',
    object: { title: 'Draft a reply to Dana Reyes', subtitle: 'dana@kestrel.example · Gmail' },
    system: 'Gmail',
    subject: { name: 'Dana Reyes' },
    outbound: {
      channel: 'email',
      mode: 'draft',
      system: 'Gmail',
      to: ['Dana Reyes <dana@kestrel.example>'],
      cc: ['Iris Nakamura <iris@kestrel.example>'],
      from: 'rowan@northwind.example',
      recipientsEditable: true,
      contentId: 'message',
      signature: 'Rowan Pike\nNorthwind · Partner',
      thread: {
        subject: 'Phase 2 priorities',
        href: 'https://mail.google.com/mail/u/0/#all/18f2c0a9d4e1b7a3',
        messages: [
          { from: 'Rowan Pike <rowan@northwind.example>', at: '2026-10-06T16:02:00.000Z', snippet: 'Dana, attaching the two Phase 2 options we walked through. Option A front-loads the data work; Option B ships the reviewer queue first.' },
          { from: 'Iris Nakamura <iris@kestrel.example>', at: '2026-10-07T13:40:00.000Z', snippet: 'Thanks Rowan. Priya and Owen are out until the 20th, so we may not get their read in time.' },
          { from: 'Dana Reyes <dana@kestrel.example>', at: '2026-10-08T18:14:00.000Z', snippet: 'Rather than wait on Priya and Owen, can we get everyone on a call early next week? I need the A vs. B call settled before our board review on the 15th.' },
        ],
      },
      doneLabel: 'Draft created',
      openLabel: 'Open in Gmail',
    },
    content: [{ kind: 'email', id: 'message', label: 'Email', subject: 'Re: Phase 2 priorities', body: BODY }],
    fields: [{ label: 'To', value: 'Dana Reyes <dana@kestrel.example>' }, { label: 'Cc', value: 'Iris Nakamura <iris@kestrel.example>' }],
    verbs: { approve: 'Create draft in Gmail', reject: 'Reject' },
  },
  ...over,
});

/** The reply draft, ready to decide. */
export const ReplyDraft: Story = {
  args: { crumbs: CRUMBS, run: replyDraft() },
};

/**
 * Proposal 8017's state: the approval was refused because the Gmail login is
 * read-only. One sentence and the reconnect; the 403 behind Details.
 */
export const ReplyDraftNeedsAccess: Story = {
  args: { crumbs: CRUMBS, run: replyDraft({ status: 'failed', error: GMAIL_SCOPE_ERROR }) },
};

/** A Slack post through the same artifact: a channel instead of addresses, no subject, no signature. */
export const SlackPost: Story = {
  args: {
    crumbs: CRUMBS,
    run: {
      id: 8020,
      actionId: 'slack.post_message',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      input: {},
      proposal: { confidence: 0.86, rationale: 'The Kestrel renewal moved to legal on Oct 9 and the deal channel has not heard since Oct 2.' },
      card: {
        title: 'Post to #kestrel-renewal',
        object: { title: 'Post to #kestrel-renewal', subtitle: 'Slack' },
        system: 'Slack',
        outbound: { channel: 'chat', mode: 'send', system: 'Slack', to: ['#kestrel-renewal'], contentId: 'message', doneLabel: 'Posted', openLabel: 'Open in Slack' },
        content: [{ kind: 'message', id: 'message', label: 'Message', body: 'Kestrel renewal is with their legal team as of today. Redlines expected by Friday; I\'ll post them here.' }],
        fields: [{ label: 'Channel', value: '#kestrel-renewal' }],
        verbs: { approve: 'Post', reject: 'Decline' },
      },
    },
  },
};

const STEPS = [
  { step: 1, day: 0, subject: 'Tideline\'s live-ops hiring', body: 'Rowan, your careers page lists two live-ops engineers alongside the new studio launch.\n\nAre you building that team in-house, or leaning on partners to cover the launch window?' },
  { step: 2, day: 3, subject: 'The launch window', body: 'Short note. The launch window is the part most studios underestimate, and it is the part a partner can absorb.' },
  { step: 3, day: 7, subject: 'Worth twenty minutes?', body: 'Last one from me. Worth twenty minutes next week to compare notes on the launch?' },
];

/** The other artifact on the same shell: a multi-touch sequence for a prospect not in a conversation. */
export const Sequence: Story = {
  args: {
    crumbs: CRUMBS,
    position: '28 of 224',
    run: {
      id: 8031,
      actionId: 'personalization.enroll',
      status: 'pending',
      invokedBy: 'agent:revenue-lead',
      input: {},
      proposal: { confidence: 0.62, rationale: 'Downloaded the inbound ebook after the LinkedIn ad, and the careers page shows two live-ops roles open beside a studio launch.' },
      card: {
        title: 'New MQL ready to enroll',
        system: 'Personalization',
        subject: { name: 'Rowan Pike', role: 'Founder & CEO', company: 'Tideline Gaming' },
        recommendation: { headline: 'Enroll in: Inbound ebook follow-up · 3 sends' },
        sequence: { name: 'Inbound ebook follow-up', contact: 'Rowan Pike', sender: 'iris@northwind.example', system: 'HubSpot' },
        content: STEPS.map(s => ({ kind: 'email' as const, id: `send-${s.step}`, label: `Day ${s.day}`, tabLabel: `Step ${s.step} · Day ${s.day} · email`, subject: s.subject, body: s.body })),
        fields: [],
        verbs: { approve: 'Queue in HubSpot', reject: 'Decline' },
      },
    },
  },
};
