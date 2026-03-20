# CLAUDE.md - CoreContext

## Project Overview

CoreContext is a multi-tenant SaaS application built on a Next.js 16 boilerplate. It provides contextual intelligence tools for teams to organize, connect, and act on business context.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript (strict)
- **Context Engine:** Onyx (self-hosted, Docker Compose)
- **Styling:** Tailwind CSS 4 + Shadcn UI (Radix primitives)
- **Auth:** Clerk (multi-tenancy via organizations, RBAC)
- **Database:** PostgreSQL + Drizzle ORM (PGLite for local dev, Docker optional)
- **Payments:** Stripe (optional, subscriptions)
- **API:** oRPC (end-to-end type-safe RPC)
- **i18n:** next-intl + Crowdin (en, fr)
- **Testing:** Vitest (unit) + Playwright (E2E)
- **Error Monitoring:** Sentry + Spotlight (dev)
- **Logging:** LogTape + Better Stack
- **Onyx API Client:** `src/libs/onyx/client.ts`

## Essential Commands

```bash
npm install               # Install dependencies
npm run dev               # Start dev server (includes PGLite DB + Spotlight)
npm run dev:next          # Next.js dev only (no DB server)
npm run build             # Production build with migrations
npm run test              # Unit tests (Vitest)
npm run test:e2e          # E2E tests (Playwright)
npm run lint              # ESLint
npm run lint:fix          # ESLint autofix
npm run check:types       # TypeScript type checking
npm run check:deps        # Check unused dependencies (knip)
npm run check:i18n        # Validate i18n translations
npm run db:generate       # Generate Drizzle migrations
npm run db:migrate        # Apply migrations
npm run db:studio         # Open Drizzle Studio (visual DB browser)
npm run storybook         # Run Storybook
npm run stripe:listen     # Listen to Stripe webhooks locally
npm run stripe:setup-price # Create Stripe prices
```

## Running Onyx (Context Engine)

```bash
./infra/onyx/setup.sh     # Clone Onyx + apply port overrides (first time only)

# Start Onyx (12 containers: API, Vespa, OpenSearch, Redis, PostgreSQL, models, etc.)
cd infra/onyx/onyx-repo/deployment/docker_compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.override.yml -p onyx-stack up -d

# Then configure in Onyx admin UI at http://localhost:3100:
# 1. Set up LLM provider (OpenAI, Anthropic, etc.)
# 2. Create API key: Admin > API Keys
# 3. Add to .env.local: ONYX_API_URL=http://localhost:8080/api  ONYX_API_KEY=your_key
```

Port map: CoreContext :3000, Onyx UI :3100, Onyx API :8080, CoreContext DB :5432, Onyx DB :5433

See `infra/README.md` for full infrastructure docs.

## Running with Docker PostgreSQL

```bash
docker compose up -d      # Start PostgreSQL on port 5432
npm run db:migrate        # Apply migrations
npm run dev:next          # Start Next.js (skip built-in PGLite)
```

The default `npm run dev` uses PGLite (in-process SQLite-like PG). For a real PostgreSQL instance, use docker-compose.yml.

## Key Directories

```
src/
├── app/[locale]/          # Next.js App Router pages (i18n)
│   ├── (marketing)/       # Landing page (public)
│   ├── (auth)/            # Authenticated pages
│   │   ├── dashboard/     # Dashboard, todos, billing, settings
│   │   └── (center)/      # Clerk sign-in/sign-up
│   ├── rpc/               # oRPC API routes
│   └── webhook/           # Stripe webhook handler
├── components/ui/         # Shadcn UI components
├── features/              # Feature-specific components
├── libs/                  # Config: DB, Env, I18n, Stripe, oRPC
├── models/Schema.ts       # Drizzle ORM schema (organization, todo tables)
├── routers/               # oRPC route handlers + auth guards
├── services/              # Business logic (Billing, Todo, Organization)
├── templates/             # Page-level templates (Navbar, Hero, Footer, etc.)
├── types/                 # TypeScript types
├── utils/AppConfig.ts     # App name, pricing plans, locale config
└── locales/               # Translation files (en.json, fr.json)
```

## Multi-Tenancy

- Clerk organizations provide multi-tenancy
- Each org has its own Stripe subscription stored in the `organization` DB table
- Data is scoped by org (via `auth()` orgId)
- Roles: `org:admin`, `org:member` (defined in `src/types/Auth.ts`)
- Enable organizations in Clerk Dashboard > Organization management > Settings

## Database Schema

- **organization** - Clerk org ID, Stripe subscription fields, timestamps
- **todo** - Sample CRUD entity scoped to user/org

To modify: edit `src/models/Schema.ts`, then `npm run db:generate && npm run db:migrate`.

## Environment Setup

Copy `.env.example` to `.env.local` and fill in your keys. Required 3rd-party services:
1. **Clerk** - Auth (publishable key + secret key)
2. **Onyx** - Context engine (API URL + API key, self-hosted via Docker)
3. **PostgreSQL** - Database (local via Docker or PGLite, production via Neon/Supabase/etc.)

Optional: Stripe (payments), Sentry, Better Stack, Checkly, Crowdin.

## Key Directories (Infrastructure)

```
infra/
├── README.md                    # Full infrastructure docs
└── onyx/
    ├── setup.sh                 # Clone + configure Onyx
    ├── docker-compose.override.yml  # Port remaps to avoid conflicts
    └── .gitignore               # Excludes cloned onyx-repo/

requirements/                    # Product specs and case studies
├── overview.md                  # Platform vision
├── architecture.md              # System architecture
├── ziggy-*.md                   # Ziggy sales agent case study
└── ...
```

## Conventions

- Conventional Commits (enforced by commitlint + lefthook)
- ESLint with Antfu config
- Strict TypeScript
- T3 Env for validated environment variables
- All translations in `src/locales/` - developers maintain `en.json`
