import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import type { RenderedMail } from '@/libs/mail/templates';
import { inviteMail, resetMail, signInLinkMail } from '@/libs/mail/authMails';

/**
 * The mails sign-in sends, exactly as a person receives them: the HTML part
 * in a frame of its own (mail clients render it in isolation, with no app
 * stylesheet), the subject above it and the plain-text part below. Rendered
 * by the same pure functions the services send (`libs/mail/authMails.ts`).
 * Fixtures are fictional.
 * @param props - The preview.
 * @param props.mail - The rendered mail: subject, HTML and plain text.
 */
function MailPreview({ mail }: { mail: RenderedMail }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <p className="text-sm">
        <span className="text-muted-foreground">Subject: </span>
        <strong>{mail.subject}</strong>
      </p>
      <iframe title={mail.subject} srcDoc={mail.html} className="h-[560px] w-full rounded-md border border-border bg-white" />
      <details open>
        <summary className="cursor-pointer text-sm text-muted-foreground">Plain-text part</summary>
        <pre className="mt-2 rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{mail.text}</pre>
      </details>
    </div>
  );
}

const meta: Meta<typeof MailPreview> = {
  title: 'Auth/Emails',
  component: MailPreview,
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<typeof MailPreview>;

const EXPIRES = new Date('2026-10-22T12:00:00Z');
const INVITE_LINK = 'https://app.northwind.example/sign-up?invite=tok';

/** "Join Northwind on Vocion": who sent it, one button, and when the link stops working. */
export const Invite: Story = {
  args: { mail: inviteMail({ orgName: 'Northwind', inviterName: 'Ada Park', role: 'member', link: INVITE_LINK, expiresAt: EXPIRES }) },
};

/** The same invite, joining as an admin. */
export const InviteAsAdmin: Story = {
  args: { mail: inviteMail({ orgName: 'Kestrel Capital', inviterName: 'Ada Park', role: 'admin', link: 'https://app.kestrel.example/sign-up?invite=tok', expiresAt: EXPIRES }) },
};

/** An invite that names nobody (a seeded one): it still says who it is from — the Org. */
export const InviteWithNoInviter: Story = {
  args: { mail: inviteMail({ orgName: 'Northwind', inviterName: null, role: 'member', link: INVITE_LINK, expiresAt: EXPIRES }) },
};

/** "Forgot password?": one button, thirty minutes, and ignoring it changes nothing. */
export const PasswordReset: Story = {
  args: { mail: resetMail('https://app.northwind.example/reset-password#token=tok') },
};

/** "Email me a sign-in link": one use, fifteen minutes. */
export const SignInLink: Story = {
  args: { mail: signInLinkMail('https://app.northwind.example/sign-in/email-link#token=tok&email=dana%40northwind.example') },
};
