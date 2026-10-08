/**
 * The words of the mails sign-in sends — an invite, a password reset, a
 * sign-in link — and how long each link works. Pure: no database, no
 * environment, nothing but `./templates`, so the services that send them
 * (`services/InviteMail.ts`, `services/auth/passwordReset.ts`,
 * `services/auth/emailLink.ts`) and Storybook
 * (`features/auth/TransactionalMail.stories.tsx`) render the same HTML.
 */

import type { RenderedMail } from './templates';
import { AppConfig } from '@/utils/AppConfig';
import { renderMail } from './templates';

/** How long a reset link works: long enough to find the mail, short enough that an old one is dead. */
export const RESET_LINK_TTL_MINUTES = 30;

/** How long a sign-in link works. */
export const EMAIL_LINK_TTL_MINUTES = 15;

/**
 * "Join Northwind on Vocion": who asked, the role, one button, and when the
 * link stops working.
 * @param input - The invite.
 * @param input.orgName - The Org it asks the person into.
 * @param input.inviterName - Who sent it, by name or address; null for an invite that names nobody.
 * @param input.role - The role they join with.
 * @param input.link - The invite link.
 * @param input.expiresAt - When the link stops working.
 */
export function inviteMail(input: { orgName: string; inviterName: string | null; role: string; link: string; expiresAt: Date }): RenderedMail {
  const app = AppConfig.name;
  const expires = input.expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const who = input.inviterName ? `${input.inviterName} invited you` : 'You are invited';
  const role = input.role === 'admin' ? 'an admin' : 'a member';
  return renderMail({
    subject: `Join ${input.orgName} on ${app}`,
    preheader: `${who} to join ${input.orgName} on ${app}.`,
    heading: `Join ${input.orgName} on ${app}`,
    paragraphs: [
      `${who} to join ${input.orgName} on ${app} as ${role}.`,
      'Accept with this email address: set a password, or continue with Google or Microsoft if this server offers them.',
    ],
    action: { label: `Join ${input.orgName}`, url: input.link },
    footnote: `This invite works once, for this email address only, until ${expires}. If you were not expecting it, you can ignore this email.`,
  });
}

/**
 * The reset mail: what was asked, the one button, how long it works, and that
 * ignoring it changes nothing.
 * @param link - The reset link.
 */
export function resetMail(link: string): RenderedMail {
  return renderMail({
    subject: `Reset your ${AppConfig.name} password`,
    preheader: `Choose a new password. The link works once, for ${RESET_LINK_TTL_MINUTES} minutes.`,
    heading: 'Reset your password',
    paragraphs: [`Someone asked to reset the password for this email on ${AppConfig.name}. If it was you, choose a new one.`],
    action: { label: 'Choose a new password', url: link },
    footnote: `The link works once and expires in ${RESET_LINK_TTL_MINUTES} minutes. If you did not ask for this, ignore this email — your password has not changed.`,
  });
}

/**
 * The sign-in link, in plain words: what it is, the link, how long it works,
 * and what to do if you did not ask.
 * @param link - The mailed link.
 */
export function signInLinkMail(link: string): RenderedMail {
  const app = AppConfig.name;
  const minutes = EMAIL_LINK_TTL_MINUTES;
  return renderMail({
    subject: `Your ${app} sign-in link`,
    preheader: `Sign in to ${app}. The link works once, for ${minutes} minutes.`,
    heading: `Sign in to ${app}`,
    paragraphs: [`Someone asked to sign in to ${app} with this email.`],
    action: { label: `Sign in to ${app}`, url: link },
    footnote: `The link works once, for ${minutes} minutes. If you did not ask for it, ignore this email — nobody can sign in without it.`,
  });
}
