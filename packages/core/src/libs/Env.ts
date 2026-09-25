import { createEnv } from '@t3-oss/env-nextjs';
import * as z from 'zod';

export const Env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    /**
     * auth.js secret. Required when VOCION_AUTH_PROVIDER is unset or 'local'.
     * Generate with: `openssl rand -base64 32`
     */
    AUTH_SECRET: z.string().min(1).optional(),
    /** local | clerk. Default 'local'. Cloud build sets 'clerk'. */
    VOCION_AUTH_PROVIDER: z.enum(['local', 'clerk']).default('local'),
    /** Clerk — required only when VOCION_AUTH_PROVIDER=clerk. */
    CLERK_SECRET_KEY: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    BILLING_PLAN_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
    /**
     * Langfuse. All four are optional here on purpose — whether tracing
     * is on, and what the defaults are, is decided in one place:
     * `libs/Langfuse/config.ts`. Declaring defaults here as well is how
     * a production deployment ended up with a tracer pointed at
     * localhost. Read them through `langfuseConfig()`, not directly.
     */
    LANGFUSE_ENABLED: z.string().optional(),
    LANGFUSE_BASE_URL: z.string().optional(),
    LANGFUSE_PROJECT_ID: z.string().optional(),
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    /**
     * Anthropic extended thinking for the `main` model role. Unset =
     * thinking disabled (default behavior). On Claude 4.6 and newer the
     * value is only the ON switch — the request goes out as adaptive
     * thinking and the model sizes its own budget. On older Claude it is
     * the token budget (e.g. 2048).
     * See `libs/llm/langchain.ts` — enabling this forces temperature 1
     * on the main model per the Anthropic API constraint.
     */
    VOCION_THINKING_BUDGET: z.coerce.number().int().positive().optional(),
    /**
     * TEMPORARY (phase 2 removes it). Set to '1' to expose the personalization
     * queue reset. Unset means the route 404s and the control does not render,
     * so taking the escape hatch away is a config change, not a deploy.
     */
    VOCION_ALLOW_QUEUE_RESET: z.string().optional(),
    /**
     * `1` makes workspace access real: a person reaches only the workspaces a
     * group or a direct grant gives them, at the role it names. Unset, every
     * member of the account reaches every workspace, which is how the platform
     * behaved before `services/WorkspaceAccessService.ts` existed.
     *
     * Off by default deliberately. Turning it on can lock a live deployment's
     * people out of workspaces they use daily, so it is switched on per
     * deployment after the backfill has been checked against real rows.
     */
    VOCION_ENFORCE_WORKSPACE_ACCESS: z.string().optional(),
    /**
     * Outbound email (`libs/mail`). Ships dark: nothing is sent unless
     * VOCION_MAIL_ENABLED is exactly '1'. The transport is Resend; the
     * sender must be on a domain verified in Resend. Read through
     * `mailEnabled()` / `mailConfig()`, not directly.
     */
    VOCION_MAIL_ENABLED: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    VOCION_MAIL_FROM: z.string().optional(),
    /**
     * Email as a chat surface (`libs/surfaces/email.ts`). Ships dark:
     * `VOCION_EMAIL_SURFACE=1` turns the Resend inbound webhook on;
     * `VOCION_MAIL_DOMAIN` is the domain workspaces may claim addresses on;
     * `RESEND_WEBHOOK_SECRET` signs the webhook (Svix, `whsec_…`).
     */
    VOCION_EMAIL_SURFACE: z.string().optional(),
    VOCION_MAIL_DOMAIN: z.string().optional(),
    RESEND_WEBHOOK_SECRET: z.string().optional(),
    /**
     * Signs deliveries to `/api/webhooks/github` (`X-Hub-Signature-256`). The
     * same secret is typed into the webhook on GitHub; unset, the route answers
     * 501 and the `github` source relies on polling alone.
     */
    GITHUB_WEBHOOK_SECRET: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_LOGGING_LEVEL: z.enum(['error', 'info', 'debug', 'warning', 'trace', 'fatal']).default('info'),
    NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN: z.string().optional(),
    NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST: z.string().optional(),
    /**
     * Browser-reachable mirrors of the two above, for "open this trace"
     * links. Needed only when the app reaches Langfuse over a private
     * hostname a browser cannot resolve, which is the self-hosted case.
     */
    NEXT_PUBLIC_LANGFUSE_BASE_URL: z.string().optional(),
    NEXT_PUBLIC_LANGFUSE_PROJECT_ID: z.string().optional(),
  },
  shared: {
    NODE_ENV: z.enum(['test', 'development', 'production']).optional(),
  },
  // You need to destructure all the keys manually
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    VOCION_AUTH_PROVIDER: process.env.VOCION_AUTH_PROVIDER,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    BILLING_PLAN_ENV: process.env.BILLING_PLAN_ENV,
    LANGFUSE_ENABLED: process.env.LANGFUSE_ENABLED,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    LANGFUSE_PROJECT_ID: process.env.LANGFUSE_PROJECT_ID,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    VOCION_THINKING_BUDGET: process.env.VOCION_THINKING_BUDGET,
    VOCION_ALLOW_QUEUE_RESET: process.env.VOCION_ALLOW_QUEUE_RESET,
    VOCION_ENFORCE_WORKSPACE_ACCESS: process.env.VOCION_ENFORCE_WORKSPACE_ACCESS,
    VOCION_MAIL_ENABLED: process.env.VOCION_MAIL_ENABLED,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    VOCION_MAIL_FROM: process.env.VOCION_MAIL_FROM,
    VOCION_EMAIL_SURFACE: process.env.VOCION_EMAIL_SURFACE,
    VOCION_MAIL_DOMAIN: process.env.VOCION_MAIL_DOMAIN,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_LOGGING_LEVEL: process.env.NEXT_PUBLIC_LOGGING_LEVEL,
    NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN: process.env.NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN,
    NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST: process.env.NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST,
    NEXT_PUBLIC_LANGFUSE_BASE_URL: process.env.NEXT_PUBLIC_LANGFUSE_BASE_URL,
    NEXT_PUBLIC_LANGFUSE_PROJECT_ID: process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID,
    NODE_ENV: process.env.NODE_ENV,
  },
});
