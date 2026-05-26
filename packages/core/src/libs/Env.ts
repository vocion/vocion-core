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
    LANGFUSE_BASE_URL: z.string().default('http://localhost:3200'),
    LANGFUSE_PROJECT_ID: z.string().default('demo'),
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_LOGGING_LEVEL: z.enum(['error', 'info', 'debug', 'warning', 'trace', 'fatal']).default('info'),
    NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN: z.string().optional(),
    NEXT_PUBLIC_BETTER_STACK_INGESTING_HOST: z.string().optional(),
    NEXT_PUBLIC_LANGFUSE_BASE_URL: z.string().default('http://localhost:3200'),
    NEXT_PUBLIC_LANGFUSE_PROJECT_ID: z.string().default('demo'),
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
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    LANGFUSE_PROJECT_ID: process.env.LANGFUSE_PROJECT_ID,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
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
