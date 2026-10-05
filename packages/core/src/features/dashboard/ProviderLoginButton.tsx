import type { ReactNode } from 'react';

const PLAIN_LOGIN_BUTTON = 'inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60';
const BRANDED_SHAPE = 'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition hover:opacity-90 disabled:opacity-60';
const MARK = 'size-4 shrink-0';

/**
 * GitHub's Invertocat, in the button's text color. Path from Simple Icons
 * (CC0), drawn from https://github.com/logos.
 */
function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={MARK} aria-hidden="true" focusable="false">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * Slack's four-color mark, as Slack serves it on slack.com
 * (a.slack-edge.com/…/marketing/img/nav/logo.svg). Simple Icons dropped
 * Slack at Slack's request, so it comes from Slack's own file.
 */
function SlackMark() {
  return (
    <svg viewBox="0 0 54 54" className={MARK} aria-hidden="true" focusable="false">
      <path fill="#E3066A" d="M11.379 33.9993C11.379 37.1358 8.84512 39.6507 5.7276 39.6507C2.61008 39.6507 0.0572205 37.1168 0.0572205 33.9993C0.0572205 30.8817 2.5911 28.3479 5.70862 28.3479H11.36V33.9993H11.379Z" />
      <path fill="#E3066A" d="M14.1962 33.9997C14.1962 30.8632 16.7301 28.3483 19.8476 28.3483C22.9651 28.3483 25.499 30.8822 25.499 33.9997V48.1353C25.499 51.2718 22.9651 53.7867 19.8476 53.7867C16.7301 53.7867 14.1962 51.2718 14.1962 48.1353V33.9997Z" />
      <path fill="#00B3FF" d="M19.8662 11.2673C16.7296 11.2673 14.2148 8.73347 14.2148 5.61594C14.2148 2.49842 16.7486 -0.0354538 19.8662 -0.0354538C22.9837 -0.0354538 25.5175 2.49842 25.5175 5.61594V11.2673H19.8662Z" />
      <path fill="#00B3FF" d="M19.8682 14.1334C23.0047 14.1334 25.5196 16.6673 25.5196 19.7848C25.5196 22.9023 22.9857 25.4362 19.8682 25.4362H5.67566C2.53916 25.4362 0.0242615 22.9023 0.0242615 19.7848C0.0242615 16.6673 2.55814 14.1334 5.67566 14.1334H19.8682Z" />
      <path fill="#41B658" d="M42.5323 19.7853C42.5323 16.6488 45.0662 14.1339 48.1837 14.1339C51.3012 14.1339 53.8351 16.6678 53.8351 19.7853C53.8351 22.9028 51.3012 25.4367 48.1837 25.4367H42.5323V19.7853Z" />
      <path fill="#41B658" d="M39.7126 19.7934C39.7126 22.9299 37.1787 25.4448 34.0612 25.4448C30.9436 25.4448 28.4098 22.911 28.4098 19.7934V5.61986C28.4098 2.48336 30.9436 -0.0315399 34.0612 -0.0315399C37.1787 -0.0315399 39.7126 2.48336 39.7126 5.61986V19.7934Z" />
      <path fill="#FCC003" d="M34.0376 42.482C37.1741 42.482 39.689 45.0158 39.689 48.1334C39.689 51.2509 37.1552 53.7848 34.0376 53.7848C30.9201 53.7848 28.3862 51.2509 28.3862 48.1334V42.482H34.0376Z" />
      <path fill="#FCC003" d="M34.0381 39.6507C30.9016 39.6507 28.3867 37.1168 28.3867 33.9993C28.3867 30.8818 30.9206 28.3479 34.0381 28.3479H48.2306C51.3671 28.3479 53.882 30.8818 53.882 33.9993C53.882 37.1168 51.3482 39.6507 48.2306 39.6507H34.0381Z" />
    </svg>
  );
}

/**
 * Atlassian's mark, in the button's text color. Path from Simple Icons
 * (CC0), drawn from https://atlassian.design/foundations/logos.
 */
function AtlassianMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={MARK} aria-hidden="true" focusable="false">
      <path d="M7.12 11.084a.683.683 0 00-1.16.126L.075 22.974a.703.703 0 00.63 1.018h8.19a.678.678 0 00.63-.39c1.767-3.65.696-9.203-2.406-12.52zM11.434.386a15.515 15.515 0 00-.906 15.317l3.95 7.9a.703.703 0 00.628.388h8.19a.703.703 0 00.63-1.017L12.63.38a.664.664 0 00-1.196.006z" />
    </svg>
  );
}

type ProviderBrand = { className: string; Mark: () => ReactNode };

/**
 * Each provider's own login button: GitHub black (#181717, its Simple Icons
 * brand color) with the white Invertocat; Slack's white button with a light
 * border and its color mark, as on Slack's "Sign in with Slack"; Atlassian
 * blue (#0052CC) with the white mark. A Map, so a provider id such as
 * "constructor" can never find something on Object's prototype.
 */
const PROVIDER_BRANDS = new Map<string, ProviderBrand>([
  ['github', { className: 'bg-[#181717] text-white dark:ring-1 dark:ring-white/25', Mark: GitHubMark }],
  ['slack', { className: 'border border-[#dddddd] bg-white text-[#1d1c1d]', Mark: SlackMark }],
  ['atlassian', { className: 'bg-[#0052CC] text-white', Mark: AtlassianMark }],
]);

/**
 * The button that starts a login, dressed in the colors and mark of the
 * provider it logs in with, so the person sees whose login opens next. Jira
 * logs in through Atlassian, so a Jira login wears Atlassian's. A provider
 * with no brand here keeps the product's own button.
 *
 * While `waitingTitle` is set it is a disabled button with no link: the chat
 * card holds its login until the reply holding the card is saved.
 * @param props - The provider, the start URL and the label.
 * @param props.provider - The connect provider id (`github`, `slack`, `atlassian`), or null when unknown.
 * @param props.href - The login's start URL.
 * @param props.waitingTitle - Why the login is not ready yet; set to disable it.
 * @param props.testId - The test id the caller's tests find the button by.
 * @param props.children - The label, which is also the button's accessible name.
 */
export function ProviderLoginButton({ provider, href, waitingTitle, testId, children }: {
  provider: string | null;
  href: string | undefined;
  waitingTitle?: string;
  testId?: string;
  children: ReactNode;
}) {
  const brand = provider ? PROVIDER_BRANDS.get(provider) : undefined;
  const className = brand ? `${BRANDED_SHAPE} ${brand.className}` : PLAIN_LOGIN_BUTTON;
  const brandName = brand ? provider ?? undefined : undefined;
  const Mark = brand?.Mark;
  if (waitingTitle) {
    return (
      <button type="button" disabled title={waitingTitle} data-testid={testId} data-brand={brandName} className={className}>
        {Mark && <Mark />}
        {children}
      </button>
    );
  }
  return (
    <a href={href} data-testid={testId} data-brand={brandName} className={className}>
      {Mark && <Mark />}
      {children}
    </a>
  );
}
