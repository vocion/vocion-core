import process from 'node:process';

/**
 * Pure helpers for a workspace's mailbox address. No database, no services:
 * `libs/workspace/applier.ts` runs inside the Temporal worker, whose bundle
 * must stay LangChain-free, so anything the applier needs from the email
 * surface lives here rather than in `services/EmailSurfaceService.ts`
 * (which imports the agent runtime).
 */

/** The domain workspaces may claim addresses on (`VOCION_MAIL_DOMAIN`). */
export function mailDomain(): string | null {
  const d = process.env.VOCION_MAIL_DOMAIN?.trim().toLowerCase();
  return d || null;
}

/**
 * `<slug>@<domain>` — the address a workspace gets when it enables its
 * mailbox without naming one.
 * @param slug - Workspace (project) slug.
 * @param domain - `VOCION_MAIL_DOMAIN`.
 */
export function defaultMailboxAddress(slug: string, domain: string): string {
  return `${slug.toLowerCase()}@${domain}`;
}

/**
 * Whether a tenant may claim this address: it must be on the deployment's mail
 * domain. Anything else would let a workspace pose as another domain.
 * @param address - Candidate address.
 * @param domain - `VOCION_MAIL_DOMAIN`.
 */
export function addressOnDomain(address: string, domain: string): boolean {
  const at = address.lastIndexOf('@');
  return at > 0 && address.slice(at + 1).toLowerCase() === domain.toLowerCase();
}

/**
 * `Workspace name <address>` — the face outbound mail from a workspace wears.
 * @param box - The workspace's display name and mailbox address.
 * @param box.projectName
 * @param box.address
 */
export function mailboxFrom(box: { projectName: string; address: string }): string {
  const name = box.projectName.replace(/[<>"]/g, '').trim();
  return name ? `${name} <${box.address}>` : box.address;
}
