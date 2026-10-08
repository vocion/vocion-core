// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/libs/sentry/options';

if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
  // Private by default — see libs/sentry/options.ts. Each variable is written
  // out in full so Next can inline it into the browser bundle.
  const { init: privacy, replayMasking } = sentryOptions({
    sendDefaultPii: process.env.NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII,
    tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
    enableLogs: process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS,
  });

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Add optional integrations for additional features
    integrations: [
      // Masked unless NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII opts in: a replay
      // otherwise records every text node on the page, which here is a
      // client's business.
      Sentry.replayIntegration(replayMasking),
      ...(privacy.enableLogs ? [Sentry.consoleLoggingIntegration()] : []),
      Sentry.browserTracingIntegration(),

      ...(process.env.NODE_ENV === 'development'
        ? [Sentry.spotlightBrowserIntegration()]
        : []),
    ],

    // sendDefaultPii, tracesSampleRate, enableLogs, and the scrub:
    // beforeSend, beforeSendTransaction and beforeBreadcrumb.
    ...privacy,

    // Define how likely Replay events are sampled.
    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: 0.1,

    // Define how likely Replay events are sampled when an error occurs.
    replaysOnErrorSampleRate: 1.0,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
