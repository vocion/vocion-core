import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './libs/sentry/options';

// Private by default — see libs/sentry/options.ts.
const { init: privacy } = sentryOptions({
  sendDefaultPii: process.env.NEXT_PUBLIC_SENTRY_SEND_DEFAULT_PII,
  tracesSampleRate: process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
  enableLogs: process.env.NEXT_PUBLIC_SENTRY_ENABLE_LOGS,
});

const sentryOptionsForServer: Sentry.NodeOptions | Sentry.EdgeOptions = {
  // Sentry DSN
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Enable Spotlight in development
  spotlight: process.env.NODE_ENV === 'development',

  integrations: privacy.enableLogs ? [Sentry.consoleLoggingIntegration()] : [],

  // sendDefaultPii, tracesSampleRate, enableLogs, and the scrub:
  // beforeSend, beforeSendTransaction and beforeBreadcrumb.
  ...privacy,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
};

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // The one durable executor (backlog 054): resumes waiting runs after every deploy.
    // Never awaited: a database that is slow to answer must not hold the server's boot.
    void import('./libs/durable/executor').then(m => m.startDurableExecutor());
    // A TURN SURVIVES A RESTART (backlog 056). Told to stop, the process lets
    // the turns it is answering finish first, up to the container's grace
    // period, instead of dying under them. Next's own handler would exit at
    // once; the image sets NEXT_MANUAL_SIG_HANDLE=true so this one runs.
    // What is still running when the wait runs out is recovered by the next
    // process from its turn row (services/chat/turnRecovery.ts).
    if (process.env.NEXT_MANUAL_SIG_HANDLE === 'true') {
      const stop = async (signal: string) => {
        const graceMs = Number(process.env.VOCION_STOP_GRACE_MS) || 50_000;
        const { activeStreamCount, whenStreamsDrained } = await import('./libs/streams/buffer');
        const before = activeStreamCount();
        console.warn('[stop] signal received; letting the turns in flight finish', { signal, turns: before, graceMs });
        const left = await whenStreamsDrained(graceMs);
        console.warn('[stop] exiting', { finished: before - left, stillRunning: left });
        process.exit(0);
      };
      process.once('SIGTERM', () => void stop('SIGTERM'));
      process.once('SIGINT', () => void stop('SIGINT'));
    }
  }
  if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      // Node.js Sentry configuration
      Sentry.init(sentryOptionsForServer);
    }

    if (process.env.NEXT_RUNTIME === 'edge') {
      // Edge Sentry configuration
      Sentry.init(sentryOptionsForServer);
    }
  }
}

export const onRequestError = Sentry.captureRequestError;
