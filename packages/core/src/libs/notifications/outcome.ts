/**
 * What one channel's attempt came to. Every adapter answers in this shape so
 * the delivery pass decides retries in one place:
 *
 * - `sent` — delivered to the service that shows it.
 * - `gone` — the device or subscription no longer exists (APNs 410, a push
 *   endpoint's 404/410): the subscription is removed, nothing retries.
 * - `retry` — worth another go later (a 5xx, a 429, a network error).
 * - `failed` — will not work by trying again (a 400 that is not "gone").
 * - `not_configured` — the server holds no key for this channel. Said, never
 *   thrown: the other channels go on.
 *
 * `error` is written for a person and never carries a secret.
 */
export type ChannelOutcome
  = | { status: 'sent' }
    | { status: 'gone'; error: string }
    | { status: 'retry'; error: string }
    | { status: 'failed'; error: string }
    | { status: 'not_configured'; error: string };

/** The message every channel renders from, one shape. */
export type NotificationMessage = {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  /** Absolute URL the notification opens, or null. */
  url: string | null;
};
