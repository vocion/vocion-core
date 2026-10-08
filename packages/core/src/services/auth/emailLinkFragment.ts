/**
 * The browser half of a mailed sign-in link: turning the fragment the link
 * carried back into Auth.js's callback. Kept free of server imports so the
 * landing page can bundle it. The server half is `emailLink.ts`.
 */

/** Auth.js's id for the email provider: links go to `/api/auth/callback/email`. */
export const EMAIL_LINK_PROVIDER_ID = 'email';

/** The page a mailed link opens. */
export const EMAIL_LINK_LANDING_PATH = '/sign-in/email-link';

/**
 * The Auth.js callback a landing page sends the person to, from the fragment
 * the mailed link carried. Only this deployment's own callback path, and only
 * the three parameters it takes — the fragment is untrusted input.
 * @param fragment - `location.hash`, with or without the `#`.
 */
export function callbackPathFromFragment(fragment: string): { path: string; email: string } | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  const token = params.get('token');
  const email = params.get('email');
  if (!token || !email) {
    return null;
  }
  const query = new URLSearchParams({ token, email });
  const callbackUrl = params.get('callbackUrl');
  if (callbackUrl) {
    query.set('callbackUrl', callbackUrl);
  }
  return { path: `/api/auth/callback/${EMAIL_LINK_PROVIDER_ID}?${query.toString()}`, email };
}
