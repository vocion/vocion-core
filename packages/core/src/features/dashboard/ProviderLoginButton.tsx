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

/**
 * HubSpot's sprocket in HubSpot orange (#FF7A59). Path from Simple Icons
 * (CC0), drawn from HubSpot's brand guidelines.
 */
function HubSpotMark() {
  return (
    <svg viewBox="0 0 24 24" fill="#FF7A59" className={MARK} aria-hidden="true" focusable="false">
      <path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z" />
    </svg>
  );
}

/**
 * Notion's cube-and-N, in the button's text color. Path from Simple Icons
 * (CC0), drawn from Notion's media kit.
 */
function NotionMark() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={MARK} aria-hidden="true" focusable="false">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </svg>
  );
}

/**
 * PostHog's hedgehog, white with its black eye, as posthog.com serves it in
 * its own favicon (posthog.com/favicon.svg), cropped to the mark.
 */
function PostHogMark() {
  return (
    <svg viewBox="33 33 234 234" className={MARK} aria-hidden="true" focusable="false">
      <path fill="#fff" d="M33 179.379L72.0038 218.33H33V179.379ZM33 169.641L81.7548 218.33H120.759L33 130.689V169.641ZM33 120.951L130.51 218.33H169.513L33 82V120.951ZM81.7548 120.951L179.264 218.33V179.379L81.7548 82V120.951ZM130.51 82V120.951L179.264 169.641V130.689L130.51 82Z" />
      <path fill="#fff" d="M266.863 203.174C256.87 203.174 247.291 199.208 240.231 192.158L186 138V218.754H266.863V203.174Z" />
      <path fill="#000" d="M209.563 202.75C213.871 202.75 217.363 199.262 217.363 194.959C217.363 190.657 213.871 187.169 209.563 187.169C205.254 187.169 201.762 190.657 201.762 194.959C201.762 199.262 205.254 202.75 209.563 202.75Z" />
    </svg>
  );
}

/**
 * Google's "G", as Google ships it in its sign-in button assets
 * (developers.google.com/identity/branding-guidelines). A file, not inline:
 * its gradient is drawn with masks and a foreignObject that do not belong
 * in a component.
 */
function GoogleMark() {
  return (
    // eslint-disable-next-line next/no-img-element
    <img src="/brand/providers/google.svg" alt="" aria-hidden className={MARK} />
  );
}

/**
 * Zoom's "zm" app icon, as zoom.com serves it for its own favicon.
 */
function ZoomMark() {
  return (
    // eslint-disable-next-line next/no-img-element
    <img src="/brand/providers/zoom.png" alt="" aria-hidden className={`${MARK} rounded-[4px]`} />
  );
}

/**
 * Apollo's starburst on its yellow tile, from Apollo's own app icon.
 */
function ApolloMark() {
  return (
    // eslint-disable-next-line next/no-img-element
    <img src="/brand/providers/apollo.svg" alt="" aria-hidden className={`${MARK} rounded-[4px]`} />
  );
}

type ProviderBrand = { className: string; Mark: () => ReactNode };

/**
 * Each provider's own login button. A Map, so a provider id such as
 * "constructor" can never find something on Object's prototype.
 *
 * - GitHub: black (#181717, its Simple Icons brand color), white Invertocat.
 * - Slack: white with a light border and its color mark, as on Slack's "Sign in with Slack".
 * - Atlassian: Atlassian blue (#0052CC), white mark.
 * - Google: Google's own sign-in button colors, light and dark, from its branding guidelines.
 * - HubSpot: white with the orange sprocket. White text on HubSpot orange is too faint to read.
 * - Notion and PostHog: black, white mark, as each draws itself on dark backgrounds.
 * - Zoom: Zoom blue (#0B5CFF), white text, its app icon.
 * - Apollo: Apollo yellow (#EBF212), black text, its app icon.
 */
const PROVIDER_BRANDS = new Map<string, ProviderBrand>([
  ['github', { className: 'bg-[#181717] text-white dark:ring-1 dark:ring-white/25', Mark: GitHubMark }],
  ['slack', { className: 'border border-[#dddddd] bg-white text-[#1d1c1d]', Mark: SlackMark }],
  ['atlassian', { className: 'bg-[#0052CC] text-white', Mark: AtlassianMark }],
  ['google', { className: 'border border-[#747775] bg-white text-[#1F1F1F] dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3]', Mark: GoogleMark }],
  ['hubspot', { className: 'border border-[#dddddd] bg-white text-[#1d1c1d]', Mark: HubSpotMark }],
  ['notion', { className: 'bg-black text-white dark:ring-1 dark:ring-white/25', Mark: NotionMark }],
  ['zoom', { className: 'bg-[#0B5CFF] text-white', Mark: ZoomMark }],
  ['posthog', { className: 'bg-black text-white dark:ring-1 dark:ring-white/25', Mark: PostHogMark }],
  ['apollo', { className: 'bg-[#EBF212] text-black', Mark: ApolloMark }],
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
 * @param props.provider - The connect provider id (`github`, `google`, `zoom`, …), or null when unknown.
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
