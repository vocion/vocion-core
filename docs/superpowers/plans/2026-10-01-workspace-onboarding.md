# Workspace Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first time an admin opens a new workspace, the workspace lead opens a setup conversation. It asks what the workspace is for, offers one-tap cards to connect the right tools, lands the person back in the same conversation after connecting, and hands off to the enabled plugins' teams (the software factory files the first products).

**Architecture:** Two nullable columns on `project` record that onboarding was opened, so it auto-opens once per workspace. Everything else it reports is computed from rows that already exist: the description, the connected sources and the enabled plugins. The procedure lives in code, in a read tool (`workspace_setup`) that returns where setup stands and the one next step. Writes reuse the existing doors:

- a new reversible `workspace.describe` action
- the existing `plugin.enable` action
- a new `offer_connection` tool that puts a link card in chat, deep-linking into the existing Sources connect flow, which now carries a signed `returnTo` back to the conversation
- the existing filing tools (`file_product`, newly opted in, and `file_repo`)

**Tech Stack:** Next.js App Router, oRPC routers, Drizzle on Postgres (PGlite in tests), LangChain `tool()`, vitest (node and browser projects), Playwright with the scripted model.

**Spec:** GitHub issue vocion/vocion-core#1028 (`gh issue view 1028 -R vocion/vocion-core`). Branch `feat/issue-1028-workspace-onboarding`, worktree `~/Documents/vocion-core-worktrees/issue-1028`.

## Global Constraints

- Conventional Commits, signed off: `git commit -s -m "feat(onboarding): …"`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- lefthook runs eslint, `check:types` and knip (`check:deps`) on commit. An export nothing imports fails the commit, so export only what another module or a test imports.
- Migrations are hand-written (`packages/core/migrations/CONVENTIONS.md`). Use `IF NOT EXISTS`, nullable columns only, and a journal entry in `migrations/meta/_journal.json`. A `.sql` file with no journal entry is silently never applied.
- Don't touch: `docs/internal/**`, `requirements/**`, `.env*`, shipped migrations, `package-lock.json`.
- Fixtures are fictional (Northwind, Kestrel Capital, Acme, `.example` emails). `realDataGuard.test.ts` fails on real data.
- No test makes a live model, OAuth provider or network call. E2E chat uses `VOCION_LLM_PROVIDER=scripted`.
- No concretions in core logic: core code never names a plugin's object type (`product`, `repo`), product or tool. The products step lives in the `software-factory` plugin.
- Structural over prompting: the procedure lives in `workspace_setup`'s output, not in a long system-prompt paragraph.
- Nothing fails silently. Every caught error is logged with context, or turned into a refusal the model can read.
- No nested functions beyond one-line expressions (Drew's standing rule). The only exceptions are React `useEffect` and LangChain `tool()` callbacks, which have no module-level form, and those bodies are a one-line call to a module-level function.
- Run commands from `packages/core` unless a step says otherwise.

## Deviations from the issue (decided here; flag in the PR)

1. **The skill becomes a tool.** A core skill can't reach every workspace lead: skills mount only through the agent's own `skills:` list (`services/playbooks/mount.ts:62`, `harness.ts` `buildInitialFiles`), and the lead is each workspace's own YAML. So `workspace_setup` returns the status and the one next step from code.
2. **The connect card deep-links into the existing Sources flow** (`/dashboard/connectors?add=<connector>&returnTo=…`). It doesn't create the source row and start OAuth itself. A source's config must be valid before its row exists: GitHub needs `repos` with at least one entry (`libs/sources/github.ts:57`), and Jira needs `baseUrl` and `projectKeys` (`libs/sources/jira.ts:53-57`). OAuth only reveals those after the grant. A second connect path would also break "one obvious path".
3. **No `source.connected` event in v1.** The person returns to the conversation with the next message pre-filled ("I connected github. What's next?"), and pressing Send continues the setup. Add the event when an automation needs it.
4. **Only two columns: `onboarding_started_at` and `onboarding_started_by`.** Auto-open fires once per workspace, so there is nothing to dismiss. "Done" is computed (a description plus at least one connected source).
5. **Auto-open is a POST from the chat client on mount**, not a write in the server component, because a `<Link>` prefetch of `/dashboard/chat` would run a GET side effect.
6. **The OAuth round trip is unit-tested, not e2e-stubbed.** No provider test double exists (`libs/connect/provider.ts`), and the e2e covers everything up to the provider redirect.
7. **Existing bug fixed in passing:** `list_capabilities` reports UI-added sources as "not connected". It compares `s.kind ?? s.slug`, but `addSource` stores `kind: 'plugin'` and the connector in `config._connector` (`SourceSyncService.ts:83`).

**Found, not fixed here (separate issue):** `POST /rpc/sources` checks only `orgId`, not admin (`app/[locale]/rpc/sources/route.ts:96`).

## Review Focus

1. **Two admins open a new workspace at the same moment.** Exactly one setup conversation should be created. Task 3 pins this with a concurrent `start` test.
2. **A member (non-admin) is the first to open the workspace.** Nothing should auto-open, and the first admin who opens it later should still get setup. Tasks 2 and 3 pin this.
3. **A crafted `returnTo`** (`//evil.example`, `https://evil.example`, `/\evil.example`, `/dashboard/../..//x`) must never redirect off-site. It should fall back to the Sources page. Task 6 pins this.
4. **The person cancels at the provider, or the connect fails.** They should land back in the conversation with an honest pre-fill naming the failure, never "I connected it". Task 8 pins this.
5. **A workspace with no `lead:`.** Setup shouldn't auto-open or error, and the chat door still works. Tasks 2 and 3 pin this.

---

## File structure

| File | Responsibility |
|---|---|
| `migrations/0161_project_onboarding.sql` (new) + `migrations/meta/_journal.json` | Two nullable columns |
| `src/models/Schema.ts` (modify `projectSchema`) | Drizzle columns |
| `src/libs/sources/connectorOf.ts` (new) | Which connector a source row belongs to |
| `src/services/agents/tools/capabilities.ts` (modify) | Use `connectorOfSource` |
| `src/services/OnboardingService.ts` (new) | Status, next step, once-only claim, opening message, due check |
| `src/routers/Onboarding.ts` (new) + `src/routers/index.ts` | `onboarding.start` |
| `src/libs/actions/workspace-describe.ts` (new) + `src/libs/actions/registry.ts` | `workspace.describe` action |
| `src/services/agents/tools/workspaceSetup.ts` (new) | `workspace_setup` tool |
| `src/services/agents/tools/offerConnection.ts` (new) | `offer_connection` tool + `connectHref` |
| `src/services/agents/tools/registry.ts` (modify) | Register both tools |
| `src/libs/cards/card.ts` (modify) | `link` card kind |
| `src/app/[locale]/rpc/agent/stream/route.ts` (modify `sendEvent`) | Surface a tool's own `card` event |
| `src/features/dashboard/chat/useChatSession.ts` (modify `case 'card'`) | Keep the link on action-less cards |
| `src/features/dashboard/chat/RecommendedActionCard.tsx` (modify) | Link button for action-less cards |
| `src/libs/connect/returnTo.ts` (new) | `safeReturnPath`, `connectStartHref`, `connectReturnPrompt` |
| `src/libs/connect/state.ts`, `routes.ts`, `app/api/connect/[provider]/{start,callback}/route.ts` (modify) | Carry and honour `returnTo` |
| `src/features/dashboard/SourcesPanel.tsx` (modify) | `?add=` and `?returnTo=` |
| `src/features/dashboard/chat/onboardingStart.ts` (new) + `ChatShell.tsx` + `app/[locale]/(auth)/dashboard/chat/page.tsx` | Auto-open and the return pre-fill |
| `templates/plugins/software-factory/objects/product/type.yaml`, `skills/products-from-repos/SKILL.md`, `agents/product-manager.yaml`, `plugin.yaml` | `file_product` and the products hand-off |
| `e2e/onboarding/**`, `playwright.config.ts`, `package.json` | Scripted e2e |
| `docs/guides/onboarding.md` (new), `docs/guides/agent-tools.md`, `docs/guides/connect.md` | Docs |

---

### Task 1: Onboarding columns and the connector-of-source fix

**Files:**
- Create: `packages/core/migrations/0161_project_onboarding.sql`
- Modify: `packages/core/migrations/meta/_journal.json` (append after the `0160_sync_checkpoint_skipped` entry)
- Modify: `packages/core/src/models/Schema.ts` (in `projectSchema`, after `pausedNote`)
- Create: `packages/core/src/libs/sources/connectorOf.ts`
- Modify: `packages/core/src/services/agents/tools/capabilities.ts:38`
- Test: `packages/core/src/libs/sources/connectorOf.test.ts`

**Interfaces:**
- Produces: `projectSchema.onboardingStartedAt: Date | null` and `projectSchema.onboardingStartedBy: string | null`
- Produces: `connectorOfSource(source: { slug: string; kind: string | null; config: Record<string, unknown> }): string`

- [ ] **Step 1: Write the failing test**

<!-- eslint-skip -->
```ts
// packages/core/src/libs/sources/connectorOf.test.ts
import { describe, expect, it } from 'vitest';
import { connectorOfSource } from './connectorOf';

describe('connectorOfSource — which connector a source row is', () => {
  it('reads _connector first: a source added in the UI is stored as kind "plugin"', () => {
    expect(connectorOfSource({ slug: 'github-northwind', kind: 'plugin', config: { _connector: 'github', repos: ['northwind/app'] } })).toBe('github');
  });
  it('falls back to kind for a source applied from workspace YAML', () => {
    expect(connectorOfSource({ slug: 'crm', kind: 'hubspot', config: {} })).toBe('hubspot');
  });
  it('falls back to slug when kind is the generic "plugin" and no _connector is stored', () => {
    expect(connectorOfSource({ slug: 'slack', kind: 'plugin', config: {} })).toBe('slack');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/libs/sources/connectorOf.test.ts`
Expected: FAIL, `Failed to resolve import "./connectorOf"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/libs/sources/connectorOf.ts
/**
 * Which connector a source row belongs to. A source added in the UI is
 * stored as `kind: 'plugin'` with the connector in `config._connector`
 * (`addSource`, SourceSyncService.ts); one applied from workspace YAML
 * carries the connector as its `kind`. Reading only `kind` reported every
 * UI-added source as "not connected" (#1028).
 * @param source - The source row as `listSources` returns it.
 * @returns The connector slug, e.g. "github".
 */
export function connectorOfSource(source: { slug: string; kind: string | null; config: Record<string, unknown> }): string {
  const stored = source.config._connector;
  if (typeof stored === 'string' && stored.length > 0) {
    return stored;
  }
  if (source.kind && source.kind !== 'plugin') {
    return source.kind;
  }
  return source.slug;
}
```

In `capabilities.ts`, add `import { connectorOfSource } from '@/libs/sources/connectorOf';` and change line 38 to:

<!-- eslint-skip -->
```ts
      const connected = new Set((await listSources(ctx.orgId)).map(connectorOfSource));
```

Migration:

```sql
-- packages/core/migrations/0161_project_onboarding.sql
-- Workspace onboarding (#1028): when the first-run setup conversation was
-- opened, and by whom. Auto-open fires only while started_at is null, so it
-- opens once per workspace. Everything else setup reports is read from rows
-- that already exist (the description, sources, enabled plugins).
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "onboarding_started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "onboarding_started_by" text;
```

Journal entry, appended to `entries`:

<!-- eslint-skip -->
```json
{"idx":161,"version":"7","when":1790900360000,"tag":"0161_project_onboarding","breakpoints":true}
```

Schema, in `projectSchema` after `pausedNote`:

<!-- eslint-skip -->
```ts
    /** When the first-run setup conversation was opened (#1028). Auto-open fires only while this is null. */
    onboardingStartedAt: timestamp('onboarding_started_at', { mode: 'date' }),
    /** Who opened it: a user id, no FK, like `pausedBy`. */
    onboardingStartedBy: text('onboarding_started_by'),
```

- [ ] **Step 4: Run the tests and the migration checker**

Run: `npx vitest run src/libs/sources/connectorOf.test.ts && npm run check:migrations && npm run check:types`
Expected: PASS, the checker reports no unsafe statements, and the types are clean.

- [ ] **Step 5: Commit**

```bash
git add migrations/0161_project_onboarding.sql migrations/meta/_journal.json src/models/Schema.ts src/libs/sources/connectorOf.ts src/libs/sources/connectorOf.test.ts src/services/agents/tools/capabilities.ts
git commit -s -m "feat(onboarding): record when a workspace's setup was opened; read a source's connector from _connector" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: OnboardingService

**Files:**
- Create: `packages/core/src/services/OnboardingService.ts`
- Test: `packages/core/src/services/OnboardingService.test.ts`

**Interfaces:**
- Consumes: `connectorOfSource` (Task 1), `listSources(orgId)` (`services/SourceSyncService.ts:1348`), `listConnectors()` (`libs/sources/registry.ts:43`)
- Produces:
  - `type OnboardingStatus = { startedAt: Date | null; description: string | null; connectedConnectors: string[]; enabledPlugins: string[]; done: boolean }`
  - `type OnboardingStep = 'describe' | 'connect' | 'grow'`
  - `onboardingStatus(orgId: string): Promise<OnboardingStatus | null>`
  - `nextOnboardingStep(status: OnboardingStatus): OnboardingStep`
  - `claimOnboardingStart(orgId: string, userId: string): Promise<boolean>`
  - `releaseOnboardingStart(orgId: string, userId: string): Promise<void>`
  - `onboardingOpeningMessage(input: { workspaceName: string; description: string | null }): string`
  - `isOnboardingDue(input: { orgId: string; role: string | null; resuming: boolean }): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

<!-- eslint-skip -->
```ts
// packages/core/src/services/OnboardingService.test.ts
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { knowledgeSourceSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const svc = await import('./OnboardingService');

const FRESH = 'org_onb_fresh';
const DESCRIBED = 'org_onb_described';
const LEADLESS = 'org_onb_leadless';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-onb', name: 'Northwind', slug: 'northwind-onb' });
  await db.insert(projectSchema).values([
    { id: FRESH, accountId: 'acct-onb', slug: 'fresh', name: 'Northwind Fresh', leadAgentSlug: 'workspace-lead' },
    { id: DESCRIBED, accountId: 'acct-onb', slug: 'described', name: 'Northwind Eng', leadAgentSlug: 'workspace-lead', description: 'Northwind engineering: ship the customer portal.' },
    { id: LEADLESS, accountId: 'acct-onb', slug: 'leadless', name: 'Northwind Ops' },
  ]);
  await db.insert(knowledgeSourceSchema).values({ orgId: DESCRIBED, slug: 'github-northwind', configJson: { _connector: 'github', repos: ['northwind/portal'] } });
});

describe('onboardingStatus — computed from rows, never stored checkmarks', () => {
  it('a fresh workspace has nothing done and its next step is to describe it', async () => {
    const status = (await svc.onboardingStatus(FRESH))!;
    expect(status).toMatchObject({ startedAt: null, description: null, connectedConnectors: [], done: false });
    expect(svc.nextOnboardingStep(status)).toBe('describe');
  });
  it('a described workspace with a UI-added GitHub source is done and grows next', async () => {
    const status = (await svc.onboardingStatus(DESCRIBED))!;
    expect(status.connectedConnectors).toEqual(['github']);
    expect(status.done).toBe(true);
    expect(svc.nextOnboardingStep(status)).toBe('grow');
  });
  it('deleting the source makes the connect step not done again', async () => {
    await db.delete(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, DESCRIBED));
    const status = (await svc.onboardingStatus(DESCRIBED))!;
    expect(status.done).toBe(false);
    expect(svc.nextOnboardingStep(status)).toBe('connect');
  });
  it('a whitespace-only description counts as no description', async () => {
    await db.update(projectSchema).set({ description: '   ' }).where(eq(projectSchema.id, FRESH));
    expect((await svc.onboardingStatus(FRESH))!.description).toBeNull();
  });
});

describe('claimOnboardingStart — once per workspace', () => {
  it('the first claim wins and the second loses', async () => {
    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-1')).toBe(true);
    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-2')).toBe(false);
  });
  it('release by the claimer reopens it; release by someone else does not', async () => {
    await svc.releaseOnboardingStart(FRESH, 'usr-admin-2');
    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-3')).toBe(false);
    await svc.releaseOnboardingStart(FRESH, 'usr-admin-1');
    expect(await svc.claimOnboardingStart(FRESH, 'usr-admin-3')).toBe(true);
  });
});

describe('isOnboardingDue', () => {
  it('is never due for a member, so the first admin still gets it later', async () => {
    expect(await svc.isOnboardingDue({ orgId: DESCRIBED, role: 'member', resuming: false })).toBe(false);
    expect(await svc.isOnboardingDue({ orgId: DESCRIBED, role: 'admin', resuming: false })).toBe(true);
  });
  it('is not due when the person is resuming a conversation or arrived with a prompt', async () => {
    expect(await svc.isOnboardingDue({ orgId: DESCRIBED, role: 'admin', resuming: true })).toBe(false);
  });
  it('is not due for a workspace with no lead', async () => {
    expect(await svc.isOnboardingDue({ orgId: LEADLESS, role: 'admin', resuming: false })).toBe(false);
  });
  it('is not due once it has been opened', async () => {
    expect(await svc.isOnboardingDue({ orgId: FRESH, role: 'admin', resuming: false })).toBe(false);
  });
});

describe('onboardingOpeningMessage', () => {
  it('asks what the workspace is for when there is no description', () => {
    expect(svc.onboardingOpeningMessage({ workspaceName: 'Northwind Fresh', description: null })).toMatch(/what is this workspace for/i);
  });
  it('confirms an existing description instead of asking again', () => {
    const text = svc.onboardingOpeningMessage({ workspaceName: 'Northwind Eng', description: 'Northwind engineering' });
    expect(text).toContain('"Northwind engineering"');
    expect(text).not.toMatch(/what is this workspace for/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/services/OnboardingService.test.ts`
Expected: FAIL, `Failed to resolve import "./OnboardingService"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/services/OnboardingService.ts
/**
 * Workspace onboarding (#1028). What setup reports is computed from rows
 * that already exist (the description, the connected sources, the enabled
 * plugins), so it can never claim a step that did not happen. The only
 * stored state is when setup was opened, which is what makes auto-open
 * fire once per workspace.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { listConnectors } from '@/libs/sources/registry';
import { projectSchema } from '@/models/Schema';
import { listSources } from '@/services/SourceSyncService';

export type OnboardingStatus = {
  startedAt: Date | null;
  description: string | null;
  connectedConnectors: string[];
  enabledPlugins: string[];
  done: boolean;
};

export type OnboardingStep = 'describe' | 'connect' | 'grow';

/**
 * Where this workspace's setup stands.
 * @param orgId - The workspace (project) id.
 * @returns The status, or null when the workspace does not exist.
 */
export async function onboardingStatus(orgId: string): Promise<OnboardingStatus | null> {
  const [project] = await db
    .select({ startedAt: projectSchema.onboardingStartedAt, description: projectSchema.description, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project) {
    return null;
  }
  const known = new Set(listConnectors().map(c => c.slug));
  const connectedConnectors = [...new Set((await listSources(orgId)).map(connectorOfSource))].filter(slug => known.has(slug)).sort();
  const description = project.description?.trim() ? project.description.trim() : null;
  return { startedAt: project.startedAt, description, connectedConnectors, enabledPlugins: project.enabledPlugins, done: description !== null && connectedConnectors.length > 0 };
}

/**
 * The one next step: describe, then connect, then grow (plugins and team hand-offs).
 * @param status - From `onboardingStatus`.
 * @returns The step `workspace_setup` tells the model to take.
 */
export function nextOnboardingStep(status: OnboardingStatus): OnboardingStep {
  if (!status.description) {
    return 'describe';
  }
  return status.connectedConnectors.length === 0 ? 'connect' : 'grow';
}

/**
 * Mark setup opened, atomically: of two admins opening a new workspace at
 * the same moment, exactly one wins.
 * @param orgId - The workspace.
 * @param userId - Who is opening it.
 * @returns True when this call opened it.
 */
export async function claimOnboardingStart(orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(projectSchema)
    .set({ onboardingStartedAt: new Date(), onboardingStartedBy: userId })
    .where(and(eq(projectSchema.id, orgId), isNull(projectSchema.onboardingStartedAt)))
    .returning({ id: projectSchema.id });
  return rows.length === 1;
}

/**
 * Undo a claim whose conversation could not be created, so the next visit
 * tries again. Only the claimer's own claim is released.
 * @param orgId - The workspace.
 * @param userId - The claimer.
 */
export async function releaseOnboardingStart(orgId: string, userId: string): Promise<void> {
  await db
    .update(projectSchema)
    .set({ onboardingStartedAt: null, onboardingStartedBy: null })
    .where(and(eq(projectSchema.id, orgId), eq(projectSchema.onboardingStartedBy, userId)));
}

/**
 * The lead's first message in the setup conversation. Written by code, not
 * a model: it costs nothing, and it reads the same for everyone.
 * @param input.workspaceName - The workspace's display name.
 * @param input.description - Its saved description, if any.
 * @returns Markdown.
 */
export function onboardingOpeningMessage(input: { workspaceName: string; description: string | null }): string {
  const ask = input.description
    ? `You've described it as "${input.description}". Is that still right?`
    : 'To start: what is this workspace for? Which client or team, and what outcome should it help with?';
  return [
    `Welcome to **${input.workspaceName}**. I'll set it up with you: what it's for, which tools to connect, and what to turn on.`,
    '',
    ask,
    '',
    'You can say "onboard this workspace" any time to pick this back up.',
  ].join('\n');
}

/**
 * Should the chat open setup for this visit? Only for an admin (only an
 * admin can connect a source), only once, only when there is a lead to
 * talk to, and never over a conversation the person came to resume.
 * @param input.orgId - The workspace.
 * @param input.role - The viewer's session role.
 * @param input.resuming - The visit names a conversation, a new chat or a prompt.
 * @returns True when the chat should call `onboarding.start`.
 */
export async function isOnboardingDue(input: { orgId: string; role: string | null; resuming: boolean }): Promise<boolean> {
  if (input.role !== 'admin' || input.resuming) {
    return false;
  }
  const [project] = await db
    .select({ startedAt: projectSchema.onboardingStartedAt, leadAgentSlug: projectSchema.leadAgentSlug })
    .from(projectSchema)
    .where(eq(projectSchema.id, input.orgId))
    .limit(1);
  return Boolean(project && project.startedAt === null && project.leadAgentSlug);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/OnboardingService.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/OnboardingService.ts src/services/OnboardingService.test.ts
git commit -s -m "feat(onboarding): setup status computed from rows, opened once per workspace" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `onboarding.start` router

**Files:**
- Create: `packages/core/src/routers/Onboarding.ts`
- Modify: `packages/core/src/routers/index.ts` (import near line 117, then add `onboarding: { start: startOnboardingRoute },` inside `export const router = {…}`)
- Test: `packages/core/src/routers/Onboarding.test.ts`

**Interfaces:**
- Consumes: `claimOnboardingStart`, `releaseOnboardingStart`, `onboardingOpeningMessage` (Task 2); `createConversation`, `appendMessage` (`services/ConversationService.ts:80,302`); `guardAuth`, `guardRole`, `loadProject` (`routers/AuthGuards.ts`)
- Produces: `client.onboarding.start(): Promise<{ conversationId: number | null; reason: 'no-lead' | 'already-started' | null }>`

- [ ] **Step 1: Write the failing test**

<!-- eslint-skip -->
```ts
// packages/core/src/routers/Onboarding.test.ts
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', async () => {
  const real = await vi.importActual<typeof import('./AuthGuards')>('./AuthGuards');
  return { ...real, guardAuth: vi.fn(), guardRole: vi.fn() };
});
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { conversationSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { guardAuth, guardRole } = await import('./AuthGuards');
const { start } = await import('./Onboarding');

type StartResult = { conversationId: number | null; reason: string | null };
function call(): Promise<StartResult> {
  const procedure = start as unknown as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<StartResult> } };
  return procedure['~orpc'].handler({ input: undefined, context: {} });
}
function signedInAs(projectId: string, userId = 'usr-admin') {
  const ctx = { userId, orgId: projectId, accountId: 'acct-onb-r', projectId, role: 'admin', has: () => true };
  vi.mocked(guardAuth).mockResolvedValue(ctx as never);
  vi.mocked(guardRole).mockResolvedValue(ctx as never);
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-onb-r', name: 'Kestrel Capital', slug: 'kestrel-onb' });
  await db.insert(projectSchema).values([
    { id: 'org_onb_r1', accountId: 'acct-onb-r', slug: 'r1', name: 'Kestrel Deals', leadAgentSlug: 'workspace-lead' },
    { id: 'org_onb_r2', accountId: 'acct-onb-r', slug: 'r2', name: 'Kestrel Ops' },
  ]);
});
beforeEach(() => vi.mocked(guardRole).mockReset());

describe('onboarding.start', () => {
  it('opens one conversation with the lead greeting first; a second call opens none', async () => {
    signedInAs('org_onb_r1');
    const first = await call();
    expect(first.conversationId).toEqual(expect.any(Number));
    const [convo] = await db.select().from(conversationSchema).where(eq(conversationSchema.id, first.conversationId!));
    expect(convo!.agentSlug).toBe('workspace-lead');
    expect(await call()).toEqual({ conversationId: null, reason: 'already-started' });
  });

  it('two admins at once: exactly one conversation', async () => {
    await db.update(projectSchema).set({ onboardingStartedAt: null, onboardingStartedBy: null }).where(eq(projectSchema.id, 'org_onb_r1'));
    signedInAs('org_onb_r1');
    const results = await Promise.all([call(), call()]);
    expect(results.filter(r => r.conversationId !== null)).toHaveLength(1);
  });

  it('a workspace with no lead opens nothing and stays unclaimed', async () => {
    signedInAs('org_onb_r2');
    expect(await call()).toEqual({ conversationId: null, reason: 'no-lead' });
    const [row] = await db.select({ startedAt: projectSchema.onboardingStartedAt }).from(projectSchema).where(eq(projectSchema.id, 'org_onb_r2'));
    expect(row!.startedAt).toBeNull();
  });

  it('a member is refused before anything is claimed', async () => {
    vi.mocked(guardRole).mockRejectedValue(new Error('forbidden'));
    await expect(call()).rejects.toThrow('forbidden');
  });
});
```

If `conversationSchema` is exported under another name, use that name, found with `grep -n "pgTable('conversation'" src/models/Schema.ts`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routers/Onboarding.test.ts`
Expected: FAIL, `Failed to resolve import "./Onboarding"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/routers/Onboarding.ts
import { os } from '@orpc/server';
import { appendMessage, createConversation } from '@/services/ConversationService';
import { claimOnboardingStart, onboardingOpeningMessage, releaseOnboardingStart } from '@/services/OnboardingService';
import { guardAuth, guardRole, loadProject } from './AuthGuards';

/**
 * Open the workspace's setup conversation, once (#1028). Called by the chat
 * client on mount when `isOnboardingDue` said so: a POST, never a GET side
 * effect, because a `<Link>` prefetch of the chat page would otherwise open
 * setup unseen. The claim is atomic, and a conversation that cannot be
 * created releases it, so the next visit tries again.
 */
export const start = os.handler(async () => {
  const { orgId } = await guardRole('org:admin');
  const { userId } = await guardAuth();
  const project = await loadProject(orgId);
  if (!project?.leadAgentSlug) {
    return { conversationId: null, reason: 'no-lead' as const };
  }
  if (!(await claimOnboardingStart(orgId, userId))) {
    return { conversationId: null, reason: 'already-started' as const };
  }
  try {
    const conversation = await createConversation({ orgId, agentSlug: project.leadAgentSlug, initialTitle: 'Set up this workspace', createdBy: userId });
    await appendMessage({ orgId, conversationId: conversation.id, role: 'assistant', agentSlug: project.leadAgentSlug, content: onboardingOpeningMessage({ workspaceName: project.name, description: project.description }) });
    return { conversationId: conversation.id, reason: null };
  } catch (err) {
    console.warn('onboarding: could not open the setup conversation; released the claim', { orgId, error: (err as Error).message });
    await releaseOnboardingStart(orgId, userId);
    throw err;
  }
});
```

In `routers/index.ts`, add `import { start as startOnboardingRoute } from './Onboarding';` next to the other route imports, and `onboarding: { start: startOnboardingRoute },` in the router object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/routers/Onboarding.test.ts && npm run check:types`
Expected: PASS, 4 tests; types clean.

- [ ] **Step 5: Commit**

```bash
git add src/routers/Onboarding.ts src/routers/Onboarding.test.ts src/routers/index.ts
git commit -s -m "feat(onboarding): onboarding.start opens the setup conversation once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `workspace.describe` action

**Files:**
- Create: `packages/core/src/libs/actions/workspace-describe.ts`
- Modify: `packages/core/src/libs/actions/registry.ts` (import beside `pluginEnableAction` at :30, then `registerAction(workspaceDescribeAction);` beside :149)
- Test: `packages/core/src/libs/actions/workspace-describe.test.ts`

**Interfaces:**
- Produces: action id `workspace.describe` with input `{ description: string }` (trimmed, 10 to 600 characters), grant `manage_workspace`, reversible

- [ ] **Step 1: Write the failing test**

<!-- eslint-skip -->
```ts
// packages/core/src/libs/actions/workspace-describe.test.ts
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { workspaceDescribeAction } = await import('./workspace-describe');

const ORG = 'org_describe';
async function descriptionOf(): Promise<string | null> {
  const [row] = await db.select({ d: projectSchema.description }).from(projectSchema).where(eq(projectSchema.id, ORG));
  return row!.d;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-describe', name: 'Acme', slug: 'acme-describe' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-describe', slug: 'acme', name: 'Acme', description: 'Old words' });
});

describe('workspace.describe', () => {
  it('refuses a description too short to say what the workspace is for', () => {
    expect(workspaceDescribeAction.inputSchema.safeParse({ description: 'eng' }).success).toBe(false);
  });
  it('saves the description, and undo puts the previous one back', async () => {
    const input = workspaceDescribeAction.inputSchema.parse({ description: '  Acme support: answer tickets within a day.  ' });
    const result = await workspaceDescribeAction.execute({ orgId: ORG }, input);
    expect(await descriptionOf()).toBe('Acme support: answer tickets within a day.');
    await workspaceDescribeAction.undo!({ orgId: ORG }, input, result);
    expect(await descriptionOf()).toBe('Old words');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/libs/actions/workspace-describe.test.ts`
Expected: FAIL, `Failed to resolve import "./workspace-describe"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/libs/actions/workspace-describe.ts
import type { Action, ActionContext } from './types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { projectSchema } from '@/models/Schema';

const workspaceDescribeInput = z.object({
  description: z.string().trim().min(10).max(600),
});

/**
 * Write a workspace's description. The applier never writes
 * `project.description`, so a saved description survives every apply.
 * @param ctx - Action context (the workspace).
 * @param description - The new value, or null to clear it.
 */
async function writeDescription(ctx: ActionContext, description: string | null): Promise<void> {
  await db.update(projectSchema).set({ description }).where(eq(projectSchema.id, ctx.orgId));
}

/**
 * Save what a workspace is for (#1028). The setup conversation asks first,
 * and the answer is what makes every later recommendation fit: which
 * plugins, which connectors, which first records.
 */
export const workspaceDescribeAction: Action<typeof workspaceDescribeInput> = {
  id: 'workspace.describe',
  name: 'Describe this workspace',
  description: 'Save what this workspace is for (the client or team, and the outcome it serves) as its description. Reversible.',
  inputSchema: workspaceDescribeInput,
  grant: 'manage_workspace',
  external: false,
  dedupKeyFor: input => `workspace.describe:${input.description}`,
  async reviewCard(_ctx, input) {
    return {
      title: 'Save the workspace description',
      system: 'Workspace',
      summary: input.description,
      fields: [{ label: 'Description', value: input.description }],
      nextAction: 'Approving saves this as the workspace description. Undo puts the previous one back.',
      verbs: { approve: 'Save', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const [before] = await db.select({ description: projectSchema.description }).from(projectSchema).where(eq(projectSchema.id, ctx.orgId)).limit(1);
    await writeDescription(ctx, input.description);
    return { before: before?.description ?? null, after: input.description };
  },
  async undo(ctx, _input, result) {
    const before = typeof result.before === 'string' ? result.before : null;
    await writeDescription(ctx, before);
    return { restored: before };
  },
};
```

If `Action`'s `reviewCard` return type rejects a key, match `plugin-enable.ts` exactly. It is the reference.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/libs/actions/workspace-describe.test.ts src/libs/actions/registry.test.ts`
Expected: PASS. If a registry test enumerates action ids, add `workspace.describe` to its expected list.

- [ ] **Step 5: Commit**

```bash
git add src/libs/actions/workspace-describe.ts src/libs/actions/workspace-describe.test.ts src/libs/actions/registry.ts
git commit -s -m "feat(onboarding): workspace.describe saves what a workspace is for, reversibly" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `workspace_setup` tool

**Files:**
- Create: `packages/core/src/services/agents/tools/workspaceSetup.ts`
- Modify: `packages/core/src/services/agents/tools/registry.ts` (import, and add `workspaceSetupTool(ctx),` after `listCapabilitiesTool(ctx),` at :175)
- Modify: `docs/guides/agent-tools.md` (one table row)
- Test: `packages/core/src/services/agents/tools/workspaceSetup.test.ts`

**Interfaces:**
- Consumes: `OnboardingStatus`, `onboardingStatus`, `nextOnboardingStep` (Task 2)
- Produces: `workspaceSetupTool(ctx: RuntimeContext)` (tool name `workspace_setup`, no arguments); `renderSetupStatus(status: OnboardingStatus): string`

- [ ] **Step 1: Write the failing test**

<!-- eslint-skip -->
```ts
// packages/core/src/services/agents/tools/workspaceSetup.test.ts
import type { OnboardingStatus } from '@/services/OnboardingService';
import { describe, expect, it } from 'vitest';
import { renderSetupStatus } from './workspaceSetup';

const base: OnboardingStatus = { startedAt: null, description: null, connectedConnectors: [], enabledPlugins: [], done: false };

describe('workspace_setup tells the model the ONE next step', () => {
  it('with no description: ask what it is for, and save it with workspace.describe', () => {
    const text = renderSetupStatus(base);
    expect(text).toMatch(/NEXT: ask what this workspace is for/);
    expect(text).toContain('workspace.describe');
    expect(text).not.toContain('offer_connection');
  });
  it('described, nothing connected: offer connections, at most three', () => {
    const text = renderSetupStatus({ ...base, description: 'Northwind engineering' });
    expect(text).toMatch(/NEXT: call list_capabilities/);
    expect(text).toContain('offer_connection');
    expect(text).toMatch(/at most three/);
  });
  it('described and connected: says setup is complete and grows', () => {
    const text = renderSetupStatus({ ...base, description: 'Northwind engineering', connectedConnectors: ['github'], enabledPlugins: ['software-factory'], done: true });
    expect(text).toMatch(/Setup is complete/);
    expect(text).toContain('Connected: github');
    expect(text).toContain('plugin.enable');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/agents/tools/workspaceSetup.test.ts`
Expected: FAIL, `Failed to resolve import "./workspaceSetup"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/services/agents/tools/workspaceSetup.ts
import type { RuntimeContext } from '../types';
import type { OnboardingStatus, OnboardingStep } from '@/services/OnboardingService';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { nextOnboardingStep, onboardingStatus } from '@/services/OnboardingService';

/**
 * One instruction per step. Each names exactly one path, because a model
 * follows every branch it is given (DESIGN-PRINCIPLES: one obvious path).
 */
const STEP_GUIDE: Record<OnboardingStep, string> = {
  describe: 'NEXT: ask what this workspace is for: which client or team, and the outcome it should help with. When they answer, save it with propose_action, action workspace.describe, input {"description": "<their words, tidied>"}.',
  connect: 'NEXT: call list_capabilities, pick the plugins whose "Helps when" fits the description, and call offer_connection once for each connector they "work best with" that is not connected. Offer at most three, the most useful first.',
  grow: 'NEXT: offer to turn on the plugins whose "Helps when" fits (recommend_action, action plugin.enable, input {"slug": "<slug>"}), call offer_connection for any connector they still need, then hand each enabled plugin\'s team lead the description with task and ask what it needs to start.',
};

/**
 * The status as the model reads it: what is done, then the next step.
 * @param status - From `onboardingStatus`.
 * @returns Plain text.
 */
export function renderSetupStatus(status: OnboardingStatus): string {
  return [
    status.done ? 'Setup is complete: the workspace is described and has a connected source. Keep growing it if the person wants.' : 'Setup is in progress.',
    `Description: ${status.description ?? '(none yet)'}`,
    `Connected: ${status.connectedConnectors.length ? status.connectedConnectors.join(', ') : '(nothing yet)'}`,
    `Plugins on: ${status.enabledPlugins.length ? status.enabledPlugins.join(', ') : '(none)'}`,
    STEP_GUIDE[nextOnboardingStep(status)],
  ].join('\n');
}

/**
 * Read the status for a workspace and render it, or say plainly that there is none.
 * @param orgId - The workspace.
 * @returns The tool's text result.
 */
async function describeWorkspaceSetup(orgId: string): Promise<string> {
  const status = await onboardingStatus(orgId);
  return status ? renderSetupStatus(status) : 'This workspace was not found, so there is no setup to report.';
}

/**
 * `workspace_setup` (#1028): where this workspace's setup stands and the one
 * next step. The procedure lives here, in code, not in a skill, because a
 * core skill cannot reach every workspace's own lead.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function workspaceSetupTool(ctx: RuntimeContext) {
  return tool(
    async () => describeWorkspaceSetup(ctx.orgId),
    {
      name: 'workspace_setup',
      description: 'Where this workspace\'s setup stands (description, connected tools, plugins) and the one next step. Use it when the person asks to onboard or set up this workspace, in the setup conversation, and after they say they connected something.',
      schema: z.object({}),
    },
  );
}
```

Docs: add a row to the tool table in `docs/guides/agent-tools.md`. The row names `workspace_setup` as an always-on read that returns the setup status and its next step (#1028), using the table's existing column format.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/agents/tools/workspaceSetup.test.ts src/services/agents/tools/registry.schema.test.ts`
Expected: PASS. If the registry test lists tool names or requires a docs row per tool, add `workspace_setup` there.

- [ ] **Step 5: Commit**

```bash
git add src/services/agents/tools/workspaceSetup.ts src/services/agents/tools/workspaceSetup.test.ts src/services/agents/tools/registry.ts ../../docs/guides/agent-tools.md
git commit -s -m "feat(onboarding): workspace_setup reports setup and the one next step" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `returnTo` through the connect flow

**Files:**
- Create: `packages/core/src/libs/connect/returnTo.ts`
- Modify: `packages/core/src/libs/connect/state.ts` (payload type, `signState`, `verifyState`)
- Modify: `packages/core/src/libs/connect/routes.ts:45` (`returnUrl`)
- Modify: `packages/core/src/app/api/connect/[provider]/start/route.ts` (read `returnTo` and sign it)
- Modify: `packages/core/src/app/api/connect/[provider]/callback/route.ts` (`land` honours the verified `returnTo`)
- Modify: `docs/guides/connect.md` (one paragraph)
- Test: `packages/core/src/libs/connect/returnTo.test.ts`, plus additions to the existing `state.test.ts` and `routes.test.ts` (create them beside the source if absent)

**Interfaces:**
- Produces: `safeReturnPath(raw: unknown): string | null`; `connectStartHref(provider: string, sourceSlug: string, returnTo: string | null): string`; `connectReturnPrompt(params: { connect?: string; reason?: string; source?: string }): string | null`
- Changes: `ConnectStatePayload` gains `returnTo?: string`; `signState` input gains `returnTo?: string`; `returnUrl(origin, outcome, sourceSlug?, returnTo?: string | null)`

- [ ] **Step 1: Write the failing tests**

<!-- eslint-skip -->
```ts
// packages/core/src/libs/connect/returnTo.test.ts
import { describe, expect, it } from 'vitest';
import { connectReturnPrompt, connectStartHref, safeReturnPath } from './returnTo';
import { returnUrl } from './routes';
import { signState, verifyState } from './state';

describe('safeReturnPath — never an open redirect', () => {
  it.each([
    ['//evil.example'],
    ['https://evil.example/dashboard/chat'],
    ['/\\evil.example'],
    ['/dashboard/../..//evil.example'],
    ['/login'],
    ['javascript:alert(1)'],
    [`/dashboard/${'x'.repeat(600)}`],
    [42],
  ])('refuses %s', (raw) => {
    expect(safeReturnPath(raw)).toBeNull();
  });
  it('keeps an in-app dashboard path with its query', () => {
    expect(safeReturnPath('/dashboard/chat?conversation=7')).toBe('/dashboard/chat?conversation=7');
  });
});

describe('returnUrl — back where the person came from', () => {
  it('lands on returnTo with the outcome added and its own query kept', () => {
    expect(returnUrl('', { ok: true }, 'github', '/dashboard/chat?conversation=7')).toBe('/dashboard/chat?conversation=7&connect=ok&source=github');
  });
  it('falls back to Sources for an unsafe returnTo', () => {
    expect(returnUrl('', { ok: false, reason: 'access_denied' }, 'github', '//evil.example')).toBe('/dashboard/sources?connect=error&reason=access_denied&source=github');
  });
});

describe('state carries returnTo, signed', () => {
  it('round-trips returnTo, and old states without it still verify', () => {
    const withBack = verifyState(signState({ provider: 'github', orgId: 'org_n', sourceSlug: 'github', userId: 'u1', returnTo: '/dashboard/chat?conversation=7' }));
    expect(withBack.ok && withBack.payload.returnTo).toBe('/dashboard/chat?conversation=7');
    const without = verifyState(signState({ provider: 'github', orgId: 'org_n', sourceSlug: 'github', userId: 'u1' }));
    expect(without.ok && without.payload.returnTo).toBeUndefined();
  });
});

describe('connectStartHref and connectReturnPrompt', () => {
  it('passes returnTo to the start route only when there is one', () => {
    expect(connectStartHref('github', 'github', null)).toBe('/api/connect/github/start?source=github');
    expect(connectStartHref('github', 'github', '/dashboard/chat?conversation=7')).toBe('/api/connect/github/start?source=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7');
  });
  it('pre-fills an honest next message: success, failure, or nothing', () => {
    expect(connectReturnPrompt({ connect: 'ok', source: 'github' })).toBe('I connected github. What\'s next?');
    expect(connectReturnPrompt({ connect: 'error', reason: 'access_denied', source: 'github' })).toBe('Connecting github didn\'t work (access_denied). What should I try?');
    expect(connectReturnPrompt({})).toBeNull();
  });
});
```

`signState` reads `AUTH_SECRET`. If the existing state tests set it with `vi.stubEnv('AUTH_SECRET', …)`, do the same at the top of this file.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/libs/connect/returnTo.test.ts`
Expected: FAIL, `Failed to resolve import "./returnTo"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/libs/connect/returnTo.ts
/**
 * Where the connect flow sends a person back to (#1028), and what it
 * pre-fills there. Only `/dashboard` paths are allowed, never `//host`, a
 * scheme or a backslash, so the OAuth callback cannot become an open
 * redirect. The value travels inside the signed state.
 */

const MAX_RETURN_PATH = 500;

/**
 * @param raw - A candidate path from a query string or a state payload.
 * @returns The path when it is a safe in-app dashboard path, else null.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_RETURN_PATH) {
    return null;
  }
  if (raw !== '/dashboard' && !raw.startsWith('/dashboard/') && !raw.startsWith('/dashboard?')) {
    return null;
  }
  if (raw.includes('\\') || raw.includes('//') || /[\u0000-\u001F]/.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * @param provider - Connect provider id (`slack`, `atlassian`, `github`).
 * @param sourceSlug - The source being connected.
 * @param returnTo - Where to land afterwards, already checked by `safeReturnPath`.
 * @returns The start route URL.
 */
export function connectStartHref(provider: string, sourceSlug: string, returnTo: string | null): string {
  const back = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
  return `/api/connect/${provider}/start?source=${encodeURIComponent(sourceSlug)}${back}`;
}

/**
 * The next message pre-filled in chat after a connect: true either way,
 * never "I connected it" when it failed.
 * @param params - The `connect`, `reason` and `source` query params the callback added.
 * @returns The message, or null when this visit is not a connect return.
 */
export function connectReturnPrompt(params: { connect?: string; reason?: string; source?: string }): string | null {
  if (!params.source) {
    return null;
  }
  if (params.connect === 'ok') {
    return `I connected ${params.source}. What's next?`;
  }
  if (params.connect === 'error') {
    return `Connecting ${params.source} didn't work (${params.reason ?? 'no reason given'}). What should I try?`;
  }
  return null;
}
```

`state.ts` has three changes:
- Add `returnTo?: string;` to `ConnectStatePayload`.
- Add `returnTo?: string` to the `signState` input, and spread `...(input.returnTo ? { returnTo: input.returnTo } : {})` into the payload.
- In `verifyState`, after the required-field check (~line 115), add:

<!-- eslint-skip -->
```ts
  if (payload.returnTo !== undefined && safeReturnPath(payload.returnTo) === null) {
    return { ok: false, reason: 'malformed' };
  }
```

The version stays `v: 1`: the field is optional, so a state signed before this change still verifies.

In `routes.ts`, change `returnUrl`'s signature and base:

<!-- eslint-skip -->
```ts
export function returnUrl(
  origin: string,
  outcome: { ok: true } | { ok: false; reason: string },
  sourceSlug?: string,
  returnTo?: string | null,
): string {
  const base = safeReturnPath(returnTo) ?? '/dashboard/sources';
  const url = new URL(`${origin || 'http://relative.invalid'}${base}`);
  // …the rest unchanged: set connect, reason, source; return as before…
}
```

In the start route, after the `source` lookup:

<!-- eslint-skip -->
```ts
  const returnTo = safeReturnPath(url.searchParams.get('returnTo'));
  const state = signState({ provider: provider.id, orgId, sourceSlug: source.slug, userId, ...(returnTo ? { returnTo } : {}) });
```

Match the route's own variable for the request URL. It already reads `?source=`.

In the callback route, `land` is a local helper ending every path. Give it a third parameter `returnTo?: string | null` that it passes to `returnUrl`. Pass `verified.payload.returnTo` (or the route's name for the verified state) at every `land(...)` call after the state is verified. Calls before verification keep landing on Sources.

Docs: in `docs/guides/connect.md`, add a short paragraph. It covers four points: the start route accepts `returnTo` (a `/dashboard` path), the path is signed into the state, the callback lands there with `connect`/`reason`/`source` appended, and anything else falls back to `/dashboard/sources`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/libs/connect`
Expected: PASS, including the existing state, routes and provider tests.

- [ ] **Step 5: Commit**

```bash
git add src/libs/connect src/app/api/connect ../../docs/guides/connect.md
git commit -s -m "feat(connect): a signed returnTo brings the person back where they started" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `offer_connection` and the link card

**Files:**
- Create: `packages/core/src/services/agents/tools/offerConnection.ts`
- Modify: `packages/core/src/services/agents/tools/registry.ts` (add `offerConnectionTool(ctx),` after `workspaceSetupTool(ctx),`)
- Modify: `packages/core/src/libs/cards/card.ts` (register the `link` kind beside the core kinds, and update the header line "Core ships…")
- Modify: `packages/core/src/app/[locale]/rpc/agent/stream/route.ts` (`sendEvent`, ~:315)
- Modify: `packages/core/src/features/dashboard/chat/useChatSession.ts` (the action-less branch of `case 'card'`, ~:787)
- Modify: `packages/core/src/features/dashboard/chat/RecommendedActionCard.tsx` (~:336-338 and ~:616)
- Modify: `docs/guides/agent-tools.md` (one row)
- Test: `packages/core/src/services/agents/tools/offerConnection.test.ts`, `packages/core/src/libs/cards/card.test.ts` (one case), `packages/core/src/features/dashboard/chat/RecommendedActionCard.link.test.tsx`

**Interfaces:**
- Consumes: `connectorOfSource` (Task 1), `getConnector` (`libs/sources/registry.ts:39`), `listSources`, `newCardId` (`libs/cards/card.ts`), `ctx.emit`, `ctx.conversationId`
- Produces: `offerConnectionTool(ctx)` (tool `offer_connection`, input `{ connector: string; why: string }`); `connectHref(connectorSlug: string, conversationId: number | undefined): string`; card kind `link`

- [ ] **Step 1: Write the failing tests**

<!-- eslint-skip -->
```ts
// packages/core/src/services/agents/tools/offerConnection.test.ts
import type { RuntimeContext } from '../types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { knowledgeSourceSchema } = await import('@/models/Schema');
const { connectHref, offerConnectionTool } = await import('./offerConnection');

const ORG = 'org_offer';
function ctxWith(emit: (event: unknown) => void): RuntimeContext {
  return { orgId: ORG, agentSlug: 'workspace-lead', conversationId: 7, connectorSources: [], emit } as unknown as RuntimeContext;
}

beforeAll(async () => {
  await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'slack', configJson: { _connector: 'slack' } });
});

describe('connectHref', () => {
  it('deep-links into the Sources add flow and back to this conversation', () => {
    expect(connectHref('github', 7)).toBe('/dashboard/connectors?add=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7');
  });
});

describe('offer_connection', () => {
  it('puts one link card in chat for a connector that is not connected', async () => {
    const emit = vi.fn();
    const out = await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'github', why: 'So the factory can read Northwind\'s repos.' });
    expect(emit).toHaveBeenCalledTimes(1);
    const card = emit.mock.calls[0]![0].card;
    expect(card).toMatchObject({ kind: 'link', actions: [], href: connectHref('github', 7), state: 'proposed' });
    expect(String(out)).toContain('Do not claim it is connected');
  });
  it('refuses an unknown connector and shows no card', async () => {
    const emit = vi.fn();
    expect(String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'ghosthub', why: 'x' }))).toMatch(/^Refused/);
    expect(emit).not.toHaveBeenCalled();
  });
  it('shows no card for a connector already connected', async () => {
    const emit = vi.fn();
    expect(String(await offerConnectionTool(ctxWith(emit)).invoke({ connector: 'slack', why: 'x' }))).toMatch(/already connected/);
    expect(emit).not.toHaveBeenCalled();
  });
});
```

Add to `card.test.ts`:

<!-- eslint-skip -->
```ts
  it('a link card needs an href; with one it reads', () => {
    const base = { id: 'card_l', kind: 'link', title: 'Connect GitHub', actions: [], source: {}, state: 'proposed' };
    expect(readCard(base).ok).toBe(false);
    expect(readCard({ ...base, href: '/dashboard/connectors?add=github' }).ok).toBe(true);
  });
```

<!-- eslint-skip -->
```tsx
// packages/core/src/features/dashboard/chat/RecommendedActionCard.link.test.tsx
import type { RecommendedAction } from './types';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';
import '@/styles/global.css';

vi.mock('@/libs/Orpc', () => ({
  client: { review: { propose: vi.fn(), actionStatus: vi.fn(), snoozeAction: vi.fn(), decideAction: vi.fn(), undoAction: vi.fn() } },
}));
vi.mock('@/libs/I18nNavigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const { TooltipProvider } = await import('@/components/ui/tooltip');
const { RecommendedActionCard } = await import('./RecommendedActionCard');

const connect: RecommendedAction = { id: 'card_l', actionId: '', input: {}, label: 'Connect GitHub', href: '/dashboard/connectors?add=github', hrefLabel: 'Connect GitHub', state: 'proposed' };

describe('a link card (offer_connection) is one button, never Approve', () => {
  it('renders the link as the button and no approve control', async () => {
    await render(<TooltipProvider><RecommendedActionCard rec={connect} /></TooltipProvider>);
    await expect.element(page.getByTestId('recommended-action-open')).toHaveAttribute('href', '/dashboard/connectors?add=github');
    expect(page.getByRole('button', { name: 'Approve' }).elements()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/services/agents/tools/offerConnection.test.ts src/libs/cards/card.test.ts && npx vitest run --project ui src/features/dashboard/chat/RecommendedActionCard.link.test.tsx`
Expected: FAIL. The import fails, the `link` kind is unknown, and `recommended-action-open` isn't found.

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/services/agents/tools/offerConnection.ts
import type { RuntimeContext } from '../types';
import type { Card } from '@/libs/cards/card';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { newCardId } from '@/libs/cards/card';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { getConnector } from '@/libs/sources/registry';
import { listSources } from '@/services/SourceSyncService';

/**
 * The existing Sources add flow for one connector, carrying a way back to
 * this conversation (#1028). One connect path, not a second one in chat.
 * @param connectorSlug - e.g. "github".
 * @param conversationId - The setup conversation, when the turn has one.
 * @returns An in-app URL.
 */
export function connectHref(connectorSlug: string, conversationId: number | undefined): string {
  const back = conversationId ? `/dashboard/chat?conversation=${conversationId}` : '/dashboard/chat';
  return `/dashboard/connectors?add=${encodeURIComponent(connectorSlug)}&returnTo=${encodeURIComponent(back)}`;
}

/**
 * Check the connector, then put its link card in chat.
 * @param ctx - The turn's runtime context.
 * @param input - The connector slug and one sentence on why.
 * @param input.connector - Connector slug.
 * @param input.why - Shown as the card's body.
 * @returns The text the model reads.
 */
async function offerConnection(ctx: RuntimeContext, input: { connector: string; why: string }): Promise<string> {
  const connector = getConnector(input.connector);
  if (!connector) {
    return `Refused: there is no connector "${input.connector}". Call list_capabilities for the connector slugs.`;
  }
  const name = connector.name ?? connector.slug;
  if ((await listSources(ctx.orgId)).some(s => connectorOfSource(s) === connector.slug)) {
    return `${name} is already connected; nothing to offer.`;
  }
  const href = connectHref(connector.slug, ctx.conversationId);
  const card: Card = { id: newCardId(), kind: 'link', title: `Connect ${name}`, body: input.why, actions: [], source: { agentSlug: ctx.agentSlug, tool: 'offer_connection' }, href, hrefLabel: `Connect ${name}`, state: 'proposed' };
  ctx.emit({ type: 'card', card });
  return `Showed a "Connect ${name}" card (${href}). After connecting, the person lands back in this conversation. Do not claim it is connected until they say so or workspace_setup shows it.`;
}

/**
 * `offer_connection` (#1028): a one-tap card that opens the connect flow for
 * one connector and returns to this conversation afterwards.
 * @param ctx - The turn's runtime context.
 * @returns The tool.
 */
export function offerConnectionTool(ctx: RuntimeContext) {
  return tool(
    async (input: { connector: string; why: string }) => offerConnection(ctx, input),
    {
      name: 'offer_connection',
      description: 'Show the person a one-tap card to connect one tool (GitHub, Jira, Slack…) to this workspace. It opens the connect flow and comes back to this conversation. Use during setup, once per connector the workspace needs.',
      schema: z.object({
        connector: z.string().min(1).describe('Connector slug from list_capabilities, e.g. "github".'),
        why: z.string().min(1).max(200).describe('One sentence on what connecting it lets this workspace do.'),
      }),
    },
  );
}
```

`card.ts`, beside the core kinds:

<!-- eslint-skip -->
```ts
registerCardKind({ kind: 'link', renderer: 'link', refine: c => (c.href ? null : 'a link card names where it opens (href)') });
```

`route.ts` `sendEvent`, before `writeEvent(event);`:

<!-- eslint-skip -->
```ts
        if (event.type === 'card') {
          // A tool's own card (offer_connection, #1028): on the ledger and the
          // wire like a recommendation. It names no action, so nothing is filed.
          pending.push(surfaceCard(event.card, { write: writeEvent, collector, where: { conversationId, agentSlug } }));
          return;
        }
```

`useChatSession.ts`, in the action-less branch, keep the link:

<!-- eslint-skip -->
```ts
          rec = { id: c.id, actionId: '', input: {}, label: c.title, ...link, ...(c.rationale ? { rationale: c.rationale } : {}), ...(c.source?.agentSlug ? { agentSlug: c.source.agentSlug } : {}), state: c.state ?? 'proposed' };
```

`RecommendedActionCard.tsx` has two changes:
- So the button is the card's one link, don't render the record-link row for an action-less card (~:338):

<!-- eslint-skip -->
```tsx
    : rec.href && rec.actionId ? { href: rec.href, label: rec.hrefLabel ?? 'Open record' } : null;
```

- Replace `: deferredUntil || !rec.actionId` and the `? null` that follows (~:616-621) with this, keeping the existing comment above `null`:

<!-- eslint-skip -->
```tsx
              : deferredUntil
                ? null
                : !rec.actionId
                  ? (rec.href
                      ? (
                          <Link href={rec.href} data-testid="recommended-action-open" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-amber-deep px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90">
                            {rec.hrefLabel ?? 'Open'}
                          </Link>
                        )
                      : null)
```

The existing `: ( <> …approve buttons… </> )` stays as the final branch.

Docs: add an `offer_connection` row to `docs/guides/agent-tools.md`. It is always on, and it shows a link card into the Sources connect flow that returns to the conversation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/agents/tools/offerConnection.test.ts src/libs/cards/card.test.ts src/services/agents/tools/registry.schema.test.ts && npx vitest run --project ui src/features/dashboard/chat/RecommendedActionCard.link.test.tsx src/features/dashboard/chat/RecommendedActionCard.test.tsx`
Expected: PASS. The existing card tests stay green: an action-less card with no href still renders no button.

- [ ] **Step 5: Commit**

```bash
git add src/services/agents/tools/offerConnection.ts src/services/agents/tools/offerConnection.test.ts src/services/agents/tools/registry.ts src/libs/cards src/app/\[locale\]/rpc/agent/stream/route.ts src/features/dashboard/chat ../../docs/guides/agent-tools.md
git commit -s -m "feat(onboarding): offer_connection puts a one-tap connect card in chat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sources honours `?add=` and `?returnTo=`, and chat auto-opens and pre-fills

**Files:**
- Modify: `packages/core/src/features/dashboard/SourcesPanel.tsx` (mount effect ~:102, `<ConnectCredentialDialog>` at :305, `ConnectCredentialDialog` props at :606, start link at :711)
- Create: `packages/core/src/features/dashboard/chat/onboardingStart.ts`
- Modify: `packages/core/src/features/dashboard/chat/ChatShell.tsx` (`ChatShellProps` :62-77 and a mount effect)
- Modify: `packages/core/src/app/[locale]/(auth)/dashboard/chat/page.tsx`
- Create: `docs/guides/onboarding.md`
- Test: `packages/core/src/features/dashboard/chat/onboardingStart.test.ts`

**Interfaces:**
- Consumes: `safeReturnPath`, `connectStartHref`, `connectReturnPrompt`, `returnUrl` (Task 6); `isOnboardingDue` (Task 2); `client.onboarding.start` (Task 3)
- Produces: `startOnboardingConversation(deps: { start: () => Promise<{ conversationId: number | null }>; open: (path: string) => void }): Promise<void>`; `ChatShell` prop `onboardingDue?: boolean`

- [ ] **Step 1: Write the failing test**

<!-- eslint-skip -->
```ts
// packages/core/src/features/dashboard/chat/onboardingStart.test.ts
import { describe, expect, it, vi } from 'vitest';
import { startOnboardingConversation } from './onboardingStart';

describe('startOnboardingConversation', () => {
  it('opens the setup conversation the server created', async () => {
    const open = vi.fn();
    await startOnboardingConversation({ start: async () => ({ conversationId: 42 }), open });
    expect(open).toHaveBeenCalledWith('/dashboard/chat?conversation=42');
  });
  it('stays put when another admin opened it first', async () => {
    const open = vi.fn();
    await startOnboardingConversation({ start: async () => ({ conversationId: null }), open });
    expect(open).not.toHaveBeenCalled();
  });
  it('a failed start is logged, and the normal chat keeps working', async () => {
    const open = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startOnboardingConversation({ start: async () => { throw new Error('offline'); }, open });
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('onboarding: could not open setup', expect.objectContaining({ error: 'offline' }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/dashboard/chat/onboardingStart.test.ts`
Expected: FAIL, `Failed to resolve import "./onboardingStart"`

- [ ] **Step 3: Implement**

<!-- eslint-skip -->
```ts
// packages/core/src/features/dashboard/chat/onboardingStart.ts
/**
 * Open the workspace's setup conversation from the chat client (#1028). A
 * POST from a mounted page, never the server render, so a prefetch cannot
 * open setup unseen. `null` means someone else already opened it.
 * @param deps.start - `client.onboarding.start`.
 * @param deps.open - Navigate within the app (router.replace).
 */
export async function startOnboardingConversation(deps: { start: () => Promise<{ conversationId: number | null }>; open: (path: string) => void }): Promise<void> {
  try {
    const { conversationId } = await deps.start();
    if (conversationId !== null) {
      deps.open(`/dashboard/chat?conversation=${conversationId}`);
    }
  } catch (err) {
    console.warn('onboarding: could not open setup', { error: (err as Error).message });
  }
}
```

ChatShell:
- Add `onboardingDue?: boolean;` to `ChatShellProps`.
- Inside the component, beside its other effects, add the block below. `useEffect` is the language construct with no module-level form, and its body is a one-line call:

<!-- eslint-skip -->
```tsx
  const onboardingOpened = useRef(false);
  useEffect(() => {
    if (props.onboardingDue && !onboardingOpened.current) {
      onboardingOpened.current = true; // StrictMode runs effects twice in dev; the server claim is atomic regardless.
      void startOnboardingConversation({ start: () => client.onboarding.start(), open: path => router.replace(path) });
    }
  }, [props.onboardingDue, router]);
```

Use the component's existing names for `client` (from `@/libs/Orpc`) and `router` (from `useRouter` in `@/libs/I18nNavigation`). Import them if ChatShell doesn't already, and match its props destructuring.

Chat page (`page.tsx`):
- Widen `searchParams` to add `connect?: string; reason?: string; source?: string`.
- Read `role` from `auth()`.
- Compute the two values below, and pass `onboardingDue={onboardingDue}` and `initialComposerValue={seededPrompt ?? connectReturnPrompt({ connect, reason, source }) ?? undefined}` to `<ChatShell>`:

<!-- eslint-skip -->
```ts
  const { orgId, role } = await auth();
  const resuming = Boolean(conversation) || startNew === '1' || Boolean(seededPrompt) || Boolean(source);
  const onboardingDue = orgId ? await isOnboardingDue({ orgId, role: role ?? null, resuming }) : false;
```

SourcesPanel:
- Add `const [returnTo, setReturnTo] = useState<string | null>(null);`.
- Extend the existing mount effect (~:102) to read `add` and `returnTo`, before its `readConnectOutcome` early return:

<!-- eslint-skip -->
```ts
    const params = new URLSearchParams(window.location.search);
    const back = safeReturnPath(params.get('returnTo'));
    if (back) {
      setReturnTo(back);
    }
    const add = params.get('add');
    if (add) {
      setAddingKind(add);
    }
```

  Strip `add` and `returnTo` from the address bar the same way the effect already strips `connect`, `reason` and `source`.
- `<ConnectCredentialDialog>` (:305): pass `returnTo={returnTo}`. Make `onConnected` land back:

<!-- eslint-skip -->
```tsx
              onConnected={async () => {
                setConnectingSource(null);
                if (returnTo) {
                  window.location.assign(returnUrl('', { ok: true }, connectingSource.slug, returnTo));
                  return;
                }
                await refresh();
              }}
```

- `ConnectCredentialDialog` (:606): add `returnTo: string | null` to its props.
- Change the start link (:711) to `href={connectStartHref(connect.provider, source.slug, returnTo)}`.

`docs/guides/onboarding.md` (new, about 40 lines) covers:
- what opens setup (the first admin visit to a workspace with a lead, once) and the "onboard this workspace" door
- the three steps `workspace_setup` walks through (describe, connect, grow)
- that "done" is computed from rows
- that the connect card goes through Sources and returns with a pre-filled message
- how to measure time to first connected source: `project.onboarding_started_at` against the first `knowledge_source.created_at`
- the deviations listed at the top of this plan

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run src/features/dashboard/chat/onboardingStart.test.ts && npx vitest run --project ui src/features/dashboard/chat/ChatShell.test.tsx && npm run check:types`
Expected: PASS. ChatShell's existing tests stay green, because `onboardingDue` defaults to undefined.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/SourcesPanel.tsx src/features/dashboard/chat/onboardingStart.ts src/features/dashboard/chat/onboardingStart.test.ts src/features/dashboard/chat/ChatShell.tsx "src/app/[locale]/(auth)/dashboard/chat/page.tsx" ../../docs/guides/onboarding.md
git commit -s -m "feat(onboarding): first admin visit opens setup; connecting returns to the conversation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The factory files the first products

**Files:**
- Modify: `packages/core/templates/plugins/software-factory/objects/product/type.yaml` (add `x-agent-file` at the same nesting as `repo/type.yaml:21`)
- Create: `packages/core/templates/plugins/software-factory/skills/products-from-repos/SKILL.md`
- Modify: `packages/core/templates/plugins/software-factory/agents/product-manager.yaml` (`skills:` list, :61-75)
- Modify: `packages/core/templates/plugins/software-factory/plugin.yaml` (`version: 2.45.0` becomes `2.46.0`, plus a changelog header entry)
- Test: `packages/core/src/services/agents/tools/fileRecord.test.ts` (one case), and the existing `src/libs/workspace/plugins.test.ts`

**Interfaces:**
- Consumes: `filingTypeOf`, `storedRequestType` helpers already in `fileRecord.test.ts`
- Produces: tool `file_product`, for agents whose `objectTypes` include `product` (the product manager already does, `product-manager.yaml:76-83`), with fields `slug, name, tagline, aliases, stage, icon, accountableUser, notes` and dedup on `slug`

- [ ] **Step 1: Write the failing test** (in `fileRecord.test.ts`, beside the `architecture_plan` case)

<!-- eslint-skip -->
```ts
describe('file_product (#1028): a product is filed with what a person would say, never derived counters', () => {
  const spec = filingTypeOf(storedRequestType('product'), {})!;
  it('is file_product, deduped by slug', () => {
    expect(spec.toolName).toBe('file_product');
    expect(spec.dedupOn).toEqual(['slug']);
  });
  it('files only the person-level fields', () => {
    expect(Object.keys(spec.properties).sort()).toEqual(['accountableUser', 'aliases', 'icon', 'name', 'notes', 'slug', 'stage', 'tagline']);
    expect(spec.properties.repos).toBeUndefined();
    expect(spec.properties.urls).toBeUndefined();
  });
});
```

If `filingTypeOf` adds envelope keys (`title`, `confidence`, `rationale`) to `properties`, compare against the type's declared fields only. Use the same filter the `architecture_plan` case uses.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/agents/tools/fileRecord.test.ts -t file_product`
Expected: FAIL, because `filingTypeOf` returns null for `product` (not opted in).

- [ ] **Step 3: Implement**

`product/type.yaml`:

<!-- eslint-skip -->
```yaml
  # FILED THROUGH ITS OWN TOOL (core: services/agents/tools/fileRecord.ts),
  # like repo. Workspace setup (#1028) files a workspace's first products
  # from the repos a person just connected. `urls`, `repos` and the counters
  # are derived or agent-maintained, and `currentFocus` is a person's: none
  # is filed. Moderated: a new product is a person's approval in Review.
  x-agent-file:
    dedupOn: [slug]
    fields: [slug, name, tagline, aliases, stage, icon, accountableUser, notes]
```

`skills/products-from-repos/SKILL.md`:

```markdown
---
slug: products-from-repos
name: Products from repos
description: >-
  After a code host is connected during workspace setup, propose the
  workspace's first products and repos from what the connection can see.
  Proposals only: each one waits for a person in Review.
version: 1
---
# Products from repos

Use this when the workspace lead hands you setup ("what do you need to start?") or a person asks you to set up products.

1. Call `describe_sources` with `github` to see which repositories the connection covers.
2. Group the repositories into products. A product is something a person would name and ship (a portal, an app, an API). A repository that only serves another product's build belongs to that product. When you can't tell, ask the person in one line; don't guess.
3. For each product, call `file_product` with `slug` (short, lowercase), `name`, `stage` (`building` unless they say it's live) and a one-line `tagline` taken from the README or the person's words. Never invent a price, an incumbent or a focus.
4. Tell the person each product is waiting in Review, and that its repositories are filed once it's accepted.
5. When a product is accepted, call `file_repo` for each of its repositories, with `slug`, `url` and `product` (the accepted product's slug).

This skill drafts only: every product and repo is a proposal a person accepts.
```

`product-manager.yaml`: append `- products-from-repos` to `skills:`.

`plugin.yaml`: set `version: 2.46.0`, and add this header entry above the newest one, in the file's existing style:

<!-- eslint-skip -->
```yaml
# 2.46.0 — products are filed through their own tool (#1028). `product` opts
#   into x-agent-file, and the PM's `products-from-repos` skill proposes a
#   workspace's first products and repos when setup hands it a connected
#   code host. Every one is a person's approval.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/agents/tools/fileRecord.test.ts src/libs/workspace/plugins.test.ts src/libs/fixtures/realDataGuard.test.ts`
Expected: PASS. The plugin loads, `products-from-repos` resolves for the PM, and the fixtures are fictional.

- [ ] **Step 5: Commit**

```bash
git add templates/plugins/software-factory src/services/agents/tools/fileRecord.test.ts
git commit -s -m "feat(software-factory): file_product, and the PM proposes first products from connected repos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Scripted end-to-end

**Files:**
- Create: `packages/core/e2e/onboarding/support/seed.ts`
- Create: `packages/core/e2e/onboarding/scripts/onboarding.json`
- Create: `packages/core/e2e/onboarding/onboarding.spec.ts`
- Modify: `packages/core/playwright.config.ts` (a scripted-only project block, after `chat-incomplete`)
- Modify: `packages/core/package.json` (`e2e:onboarding` script)

**Interfaces:**
- Consumes: everything above. The seed runs `src/scripts/create-local-user.ts` and `src/scripts/apply-workspace.ts` the way `e2e/chat-incomplete/support/seed.ts` does.

- [ ] **Step 1: Write the seed and the script**

First copy `e2e/chat-incomplete/support/seed.ts`. Then change:
- `ADMIN` to `{ name: 'Jo Rivera', account: 'Northwind Setup', email: process.env.E2E_ONBOARDING_EMAIL ?? 'onboarding@example.test', password: <same pattern as chat-incomplete> }`
- the export name to `seedOnboardingWorkspace`

Before writing, run `npx tsx src/scripts/apply-workspace.ts --help` and `npx tsx src/scripts/create-local-user.ts --help`. Confirm that a new `--account` gets its own project and that the apply targets it. If the apply targets a fixed project instead, pass the flag that names the new one.

The workspace must have a `lead:`. `templates/workspaces/client-documents` has `lead: proposal-writer`.

<!-- eslint-skip -->
```json
{
  "turns": [
    {
      "match": "northwind engineering",
      "steps": [
        { "tool": "workspace_setup", "args": {} },
        { "tool": "offer_connection", "args": { "connector": "github", "why": "So the factory can read Northwind's repositories." } }
      ],
      "reply": "Thanks. Connect GitHub below and I'll set up your products from it."
    }
  ],
  "fallback": "This scripted model has no line for that message."
}
```

- [ ] **Step 2: Write the spec**

<!-- eslint-skip -->
```ts
// packages/core/e2e/onboarding/onboarding.spec.ts
import { expect, test } from '@playwright/test';
import { ADMIN, seedOnboardingWorkspace } from './support/seed';

test.beforeAll(() => {
  seedOnboardingWorkspace();
});

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

test('first admin visit opens setup once; the connect card goes to Sources with a way back', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/chat');
  await page.waitForURL(/conversation=\d+/);
  await expect(page.getByText('I\'ll set it up with you')).toBeVisible();
  const setupUrl = page.url();

  // A second visit is ordinary chat: setup opens once per workspace.
  await page.goto('/dashboard/chat');
  await expect(page.getByText('I\'ll set it up with you')).toHaveCount(0);

  await page.goto(setupUrl);
  await page.locator('textarea').last().fill('This is for Northwind engineering: ship the customer portal.');
  await page.getByRole('button', { name: 'Send message' }).last().click();
  const connect = page.getByTestId('recommended-action-open');
  await expect(connect).toHaveText('Connect GitHub');
  await expect(connect).toHaveAttribute('href', /\/dashboard\/connectors\?add=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D\d+/);

  await connect.click();
  await page.waitForURL(/\/dashboard\/connectors/);
  await expect(page.getByRole('dialog')).toContainText('GitHub');
});
```

`signIn` is a nested function only in the sense that Playwright specs declare module-level helpers. It is declared at module level here.

- [ ] **Step 3: Wire the project and the script**

`playwright.config.ts`, after the `chat-incomplete` block:

<!-- eslint-skip -->
```ts
    // Workspace setup (#1028) against the scripted model. Defined only when
    // the server runs it, like chat-incomplete. Run with: npm run e2e:onboarding
    ...(process.env.VOCION_LLM_PROVIDER === 'scripted'
      ? [
          {
            name: 'onboarding',
            testDir: './e2e/onboarding',
            timeout: projectTimeout(180 * 1000, 120 * 1000),
            retries: 0,
            use: { ...devices['Desktop Chrome'] },
          },
        ]
      : []),
```

`package.json`:

<!-- eslint-skip -->
```json
"e2e:onboarding": "VOCION_LLM_PROVIDER=scripted VOCION_LLM_SCRIPT=e2e/onboarding/scripts/onboarding.json WORKSPACE_PATH=templates/workspaces/client-documents VOCION_DISABLE_RUNTIME=1 playwright test --project=onboarding --workers=1"
```

- [ ] **Step 4: Run it**

Run: `npm run e2e:onboarding`
Expected: 1 passed. If the dialog heading for GitHub reads differently, assert on the text `AddSourceDialog` actually renders for `github`. Don't loosen the `href` assertion.

- [ ] **Step 5: Commit**

```bash
git add e2e/onboarding playwright.config.ts package.json
git commit -s -m "test(onboarding): scripted e2e for first visit, once-only, and the connect card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Gates, diff read and PR

- [ ] **Step 1: Run every gate and keep the output for the PR**

```bash
cd packages/core
npm run check:types
npm run lint
npm run check:deps
npm run check:migrations
npx vitest run
npx vitest run --project ui src/features/dashboard/chat
npm run e2e:onboarding
```

Expected: all green. Name any skipped or failing test in the PR. Never claim "should pass".

- [ ] **Step 2: Read the diff**

Run `git diff origin/main --stat`, then the full diff. Look for debug prints, commented-out code, stray TODOs, hardcoded ids, dead exports (knip), and any edit outside the worktree.

- [ ] **Step 3: Open the PR**

- Title: `feat(onboarding): agentic first-run setup for a new workspace (#1028)`.
- The body includes:
  - the values and principles served (one obvious path, evidence you can reach, structural over prompting)
  - the "Deviations from the issue" list
  - the separate `POST /rpc/sources` admin gap
  - the pasted gate output
  - QA steps: a fresh workspace, an admin's first visit, describe it, connect GitHub, return to chat
  - one line on what was not verified (the real OAuth round trip against GitHub)
- End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Push with `git push -u origin feat/issue-1028-workspace-onboarding`. The branch has no upstream on purpose.
- Post the PR link on #1028.
