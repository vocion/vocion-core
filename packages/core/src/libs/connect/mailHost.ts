/**
 * Where a domain's mail is hosted, from its MX records — one piece of evidence
 * for "Connect your systems" (`services/connect/recommendations.ts`). Which
 * hosts mean which platform is the platform registry's to say
 * (`CredentialPlatform.discovery.mailHosts`); this only asks DNS.
 *
 * Bounded and quiet: a lookup that takes longer than `timeoutMs`, or fails for
 * any reason, answers "no evidence" rather than holding up the plan. A
 * recommendation without mail evidence is smaller, not broken.
 */

import { resolveMx } from 'node:dns/promises';

/** The MX lookup, injectable for tests: a domain in, exchange hosts out. */
export type MxResolver = (domain: string) => Promise<string[]>;

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * The real resolver: DNS MX records, by priority, exchange names only.
 * @param domain
 */
export const dnsMx: MxResolver = async (domain) => {
  const records = await resolveMx(domain);
  return records.sort((a, b) => a.priority - b.priority).map(r => r.exchange);
};

/**
 * The domain part of an address, lower-cased, when it is a plausible public
 * domain. Fixture domains (`.example`, `.test`, `.invalid`, `.localhost`) are
 * reserved and resolve nowhere, so they are not looked up at all.
 * @param email - An address.
 */
export function mailDomainOf(email: string | null | undefined): string | null {
  const domain = email?.split('@')[1]?.trim().toLowerCase().replace(/\.$/, '');
  if (!domain || !DOMAIN.test(domain)) {
    return null;
  }
  return /\.(?:example|test|invalid|localhost)$/.test(domain) ? null : domain;
}

/**
 * Whether an MX exchange host is one of a platform's mail hosts: equal to a
 * suffix, or a subdomain of one.
 * @param exchange - An MX exchange, e.g. `aspmx.l.<host>`.
 * @param suffixes - The platform's declared hosts.
 */
export function exchangeMatches(exchange: string, suffixes: readonly string[]): boolean {
  const host = exchange.toLowerCase().replace(/\.$/, '');
  return suffixes.some(s => host === s || host.endsWith(`.${s}`));
}

/**
 * The domain's MX exchanges, or an empty list when the lookup fails or runs
 * past the deadline.
 * @param domain - A domain from `mailDomainOf`.
 * @param opts - The resolver and the deadline.
 * @param opts.resolve - The MX lookup; DNS by default.
 * @param opts.timeoutMs - How long to wait; 1.5s by default.
 */
export async function mailExchangesFor(domain: string, opts: { resolve?: MxResolver; timeoutMs?: number } = {}): Promise<string[]> {
  const resolve = opts.resolve ?? dnsMx;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<string[]>((done) => {
    timer = setTimeout(() => done([]), opts.timeoutMs ?? 1500);
  });
  try {
    return await Promise.race([resolve(domain).catch(() => []), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
