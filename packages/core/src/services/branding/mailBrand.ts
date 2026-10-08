/**
 * OUTBOUND MAIL IN THE ORG'S BRAND — a header with its logo over the mail,
 * and its name on the sender.
 *
 * `sendMail` asks for this when a caller names whose mail it is
 * (`MailMessage.brand`): a workspace (`{ orgId }`), an Org (`{ accountId }`),
 * or the server's one Org (`'install'`, for mail with no workspace yet, such as
 * a sign-in link). With no brand, the message goes out exactly as written.
 *
 * - **Header** — the Org's logo (its wordmark, else its mark), at the
 *   server's public address, over a rule in the accent; the name in text when
 *   there is no logo or no public address. An SVG logo is asked for as a PNG
 *   (`?format=png`, `app/api/media/brand/…`), because most mail clients will
 *   not draw an SVG.
 * - **Sender** — the deployment's sender (`VOCION_MAIL_FROM`) under the
 *   brand's `senderName` (else its name): `Northwind <reports@…>`. A
 *   workspace's own mailbox keeps its own name, because replies to it land in
 *   that workspace's conversation and the name says which one.
 */

import type { MailMessage } from '@/libs/mail';
import type { BrandManifest } from '@/libs/workspace/brandSchema';
import { brandAccent } from '@/libs/branding/orgBrand';
import { appBaseUrl } from '@/libs/links';
import { parseBrandAssetUrl } from '@/libs/tools/artifacts/media';
import { escapeHtml } from '@/services/reports/markdownToEmailHtml';

/** Whose mail a message is, for its brand. */
export type MailBrandScope = { orgId?: string | null; accountId?: string | null } | 'install';

/**
 * `Vocion <reports@x>` → `Northwind <reports@x>`; a bare address gains the name.
 * @param from - The sender as configured.
 * @param name - The display name to send under.
 */
export function withSenderName(from: string, name: string): string {
  const clean = name.replace(/[<>"\r\n]/g, '').trim();
  if (!clean) {
    return from;
  }
  const m = /<([^>]+)>\s*$/.exec(from);
  const address = (m ? m[1]! : from).trim();
  return `${clean} <${address}>`;
}

/**
 * The header a branded mail opens with.
 * @param brand - The Org's brand.
 * @param base - The server's public address, or '' when it has none.
 */
export function mailHeaderHtml(brand: BrandManifest, base: string): string {
  const accent = brandAccent(brand) ?? '#15131a';
  const logo = brand.logos.wordmark ?? brand.logos.mark;
  const asset = logo ? parseBrandAssetUrl(logo) : null;
  const src = asset && base ? `${base}${logo}${logo!.endsWith('.svg') ? '?format=png' : ''}` : null;
  const inner = src
    ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(brand.name)}" height="28" style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none">`
    : `<span style="font:600 18px/1.2 -apple-system,Segoe UI,Roboto,sans-serif;color:#15131a">${escapeHtml(brand.name)}</span>`;
  return `<div data-org-brand-header style="margin:0 0 20px;padding:0 0 14px;border-bottom:3px solid ${accent}">${inner}</div>`;
}

/**
 * The message in the Org's brand: its header over the HTML, and its name on
 * the deployment's sender. Unchanged when the Org has no brand.
 * @param message - The mail as the caller wrote it.
 * @param scope - Whose mail it is.
 * @param configuredFrom - The deployment's sender (`VOCION_MAIL_FROM`).
 */
export async function applyMailBrand(message: MailMessage, scope: MailBrandScope, configuredFrom: string): Promise<MailMessage> {
  const { accountOfWorkspace, getOrgBrand, installAccountId } = await import('./OrgBrandService');
  const accountId = scope === 'install'
    ? await installAccountId()
    : scope.accountId ?? (scope.orgId ? await accountOfWorkspace(scope.orgId) : null);
  const brand = accountId ? await getOrgBrand(accountId) : null;
  if (!brand) {
    return message;
  }
  return {
    ...message,
    html: `${mailHeaderHtml(brand, appBaseUrl())}${message.html}`,
    // A workspace's own mailbox keeps its name; the deployment's sender takes the brand's.
    ...(message.from || !configuredFrom ? {} : { from: withSenderName(configuredFrom, brand.senderName ?? brand.name) }),
  };
}
