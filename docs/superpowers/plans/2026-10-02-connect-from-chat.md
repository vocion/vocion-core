# Connect From Chat and the Connectors Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person connects GitHub, Jira (Atlassian) or Slack with one login from a chat card or the Connectors page. The login is the approval. The credential lands in the workspace credential store (`api_token`). The agent can then read what the login sees and create the source from the person's pick.

**Architecture:** Login runs before any source exists ("grant-first"). The OAuth callback stores the grant as an `api_token` row with `obtained_via = 'login'`, links the connector's sources to it through `knowledge_source.api_token_id`, and records the dated attempt in `source_audit`. A provider-level `browse` hook lists what a grant can see (repos, sites, projects, statuses, channels). It is used by an admin-only agent tool and by an RPC route for the Connectors form. A new `source.connect` action creates the source from a picked config. A scripted provider double replaces the real providers in e2e, the way `VOCION_LLM_PROVIDER=scripted` replaces the model.

**Tech Stack:** Next.js app router, oRPC, drizzle + Postgres (PGlite in tests), zod, vitest, React Testing Library, Playwright.

**Spec:** vocion-core issue #1028 (https://github.com/vocion/vocion-core/issues/1028), sections "Connecting from chat and from the Connectors page" and "One place for every credential", and their acceptance criteria. The issue body is the binding authority.

**Branch / worktree:** `feat/issue-1028-setup-interview` at `~/Documents/vocion-core-worktrees/issue-1028-interview`, stacked on `feat/issue-1028-workspace-onboarding` (PR #1069). All paths below are relative to `packages/core/` unless they start with `docs/`.

**Companion plan:** `2026-10-02-setup-interview.md` (choice cards, the interview, product suggestions, factory rules) runs after this one and consumes Tasks 1, 8, 9 and 10.

## Global Constraints

- **Client names never appear in this repo.** `src/libs/fixtures/realDataGuard.ts` fails CI on them. Use Northwind, Acme, `northwind/portal`.
- **No test makes a live network call.** Mock `fetch` with `vi.stubGlobal('fetch', …)` or use the scripted provider double from Task 10.
- **Never nest a function inside a function.** Every helper sits at module level and takes what it needs as arguments. That includes existing closures you rewrite, such as `land` in the callback route. React `useEffect` / event-handler bodies and LangChain `tool()` callbacks may be inline only when their body is a one-line call.
- **Every outbound call you add has a timeout:** `AbortSignal.timeout(15_000)`.
- **Never log or echo a credential value.** Log the provider, the connector and a reason code only.
- **Anything dated is stated with its date.** A last-attempt line reads "Last attempt Oct 1, 4:12 PM: GitHub denied access", never only a time.
- **Copy the repo's patterns.** DB tests use `vi.mock('@/libs/DB')` (PGlite with real migrations; see `src/services/ActionService.manual.test.ts`). Actions follow `src/libs/actions/workspace-describe.ts` and register in `src/libs/actions/registry.ts`. Agent tools follow `src/services/agents/tools/offerConnection.ts`.
- **Migrations are replay-safe.** `infra/aws/migrate.sh` replays every `.sql` on every deploy. Use `ADD COLUMN IF NOT EXISTS`. Add the `_journal.json` entry. This plan's migration is `0166_api_token_login.sql`. If `main` has claimed 0166 by merge time, renumber to the tail (CONVENTIONS rule 5).
- **Markdown code fences in `docs/` need `<!-- eslint-skip -->` on the line before them,** or lint `--fix` mangles them.
- **Gates before each commit:** `npx vitest run <the task's test files>` green. Lefthook runs lint, check-types, knip, integrity and commitlint on commit. Never pass `--no-verify`.
- **Unit tests run with** `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:1/vocion_test AUTH_SECRET=ci-only-secret-not-used-by-unit-tests`. The PGlite mock ignores the URL, but `Env` validation needs one.
- **Commit messages:** conventional commits, scope `connect` / `credentials` / `cards`. End each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A re-login must keep sources working.** Logging in again to the same GitHub org, Atlassian site or Slack team keeps or replaces the credential row, and every source that pointed at the old row now points at the live one. No source is left on a revoked row (Task 3, Task 5).
2. **A login must not steal a pasted token's sources.** A source the person pointed at a pasted token stays on it after a login. For one-live platforms (GitHub), the replaced pasted row's sources are relinked, because the platform allows only one live row (Task 5).
3. **The callback with a stale or crafted state.** An expired state, another person's state, a non-admin, or a `connector` that the provider doesn't serve each land with a reason code, store nothing, and still record a failed attempt only when the person and workspace check out (Task 5).
4. **Refresh races.** Two concurrent Jira refreshes against one login row must leave one valid refresh token in that row, not a second row and not a lost update (Task 6).
5. **Browse on a broken grant.** A revoked or expired login, a vendor 401, or a vendor timeout returns a readable refusal to the agent and to the form, never a thrown 500 or a raw vendor body (Task 8).

---

### Task 1: Card runs keep what the card says

The persisted card run is lossy today (`src/services/chat/runCollector.ts:113-132`): it keeps only the title, the first action and the rationale. A reload therefore loses anything else a card shows. This task makes the run keep the card's `kind`, `body`, `fields`, `href`/`hrefLabel`, a second link, the last connect attempt and the decision. It also adds one way to patch a persisted card.

**Files:**
- Modify: `src/libs/cards/card.ts` (CardSchema)
- Modify: `src/services/ConversationService.ts:35-52` (`ConversationRun`), add `markCardRun`
- Modify: `src/services/chat/runCollector.ts:113-132` (`onCard`)
- Modify: `src/features/dashboard/chat/types.ts:104` (`RecommendedAction`)
- Modify: `src/features/dashboard/chat/useChatSession.ts:183-185` (hydrate) and `:772-796` (live `card` event)
- Test: `src/services/chat/runCollector.test.ts` (extend or create), `src/services/ConversationService.markCardRun.test.ts` (create)

**Interfaces:**
- Produces, on `CardSchema` (all optional):
  - `secondaryHref: string`, `secondaryHrefLabel: string`: a second way in, such as "Paste a token".
  - `lastAttempt: { at: string /* ISO */; reason: string; summary: string }`: the last failed connect attempt, already worded for a person.
- Produces, on the `card` arm of `ConversationRun`: `kind?`, `body?`, `fields?`, `href?`, `hrefLabel?`, `secondaryHref?`, `secondaryHrefLabel?`, `lastAttempt?`, `decision?: { action: string; at: string; by?: string }`. Keep the existing `draft?` and `state?`.
- Produces: `markCardRun(input: { orgId: string; conversationId: number; cardId: string; expectState?: CardState; patch: Partial<CardRunPatch> }): Promise<boolean>`. It returns true when a card with that id was found in that conversation (and was in `expectState`, when given) and was patched. It does this in one transaction with a `SELECT … FOR UPDATE` on the message row, so two concurrent patches can't both pass `expectState`.
  - `CardRunPatch = { state: CardState; decision: { action: string; at: string; by?: string }; lastAttempt: { at: string; reason: string; summary: string } }`
- Produces, on `RecommendedAction` (client): `kind?`, `body?`, `fields?`, `secondaryHref?`, `secondaryHrefLabel?`, `lastAttempt?`, `decision?`.

- [ ] **Step 1: Write the failing collector test.** A card with `kind: 'link'`, `body`, `fields`, `secondaryHref`, `secondaryHrefLabel` and `lastAttempt` passed to `collector.onCard(...)` comes back from `collector.finalise()` with every one of those values on the run. A second `onCard` with the same id and title, but a new `lastAttempt`, must not add a second run.

<!-- eslint-skip -->
```ts
it('keeps everything a link card shows, so a reload draws the same card', () => {
  const collector = new RunCollector();
  collector.onCard({
    id: 'card_1', kind: 'link', title: 'Connect GitHub', body: 'Your repos live there.',
    fields: [{ label: 'Account', value: 'northwind' }], actions: [], source: {}, state: 'proposed',
    href: '/api/connect/github/start?connector=github', hrefLabel: 'Connect GitHub',
    secondaryHref: '/dashboard/connectors?add=github&paste=1', secondaryHrefLabel: 'Paste a token',
    lastAttempt: { at: '2026-10-01T16:12:00.000Z', reason: 'access_denied', summary: 'GitHub denied access' },
  });
  const [run] = collector.finalise().runs.filter(r => r.type === 'card');
  expect(run).toMatchObject({
    id: 'card_1', kind: 'link', body: 'Your repos live there.', fields: [{ label: 'Account', value: 'northwind' }],
    secondaryHref: '/dashboard/connectors?add=github&paste=1', secondaryHrefLabel: 'Paste a token',
    lastAttempt: { reason: 'access_denied', summary: 'GitHub denied access' },
  });
});
```

Read `runCollector.ts` first and match its real constructor and `onCard` signature. If `onCard` takes a narrower shape than `Card`, widen it to take the fields above.

- [ ] **Step 2: Run it.** `npx vitest run src/services/chat/runCollector.test.ts`. Expected: FAIL, the new keys are missing on the run.

- [ ] **Step 3: Implement.** Add the CardSchema fields, with doc comments in the file's voice. Widen `ConversationRun`'s card arm. Copy the new keys in `onCard`. Copy them back out in both client paths of `useChatSession.ts` (the hydrate at :183 and the live event at :772), and onto `RecommendedAction`. Keep `kind` on the client object. Today both paths drop it.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Write the failing `markCardRun` tests** (PGlite via `vi.mock('@/libs/DB')`). Seed a conversation with two assistant messages, each holding one card run (`card_a`, `card_b`). Then:
  1. `markCardRun({cardId:'card_b', patch:{state:'decided', decision:{action:'approve', at, by:'user_1'}}})` returns true. Only `card_b`'s run changed, and `card_a` is byte-identical.
  2. `expectState: 'proposed'` on a card already `decided` returns false and changes nothing.
  3. A card id from another conversation in the same org returns false.
  4. Another org's conversation id returns false.

- [ ] **Step 6: Run it.** `npx vitest run src/services/ConversationService.markCardRun.test.ts`. Expected: FAIL, `markCardRun` is not exported.

- [ ] **Step 7: Implement `markCardRun`** in `ConversationService.ts`:
  - Find the conversation's assistant message whose `runs` contains `{type:'card', id: cardId}`. Use jsonb containment: `runs @> '[{"type":"card","id":"<id>"}]'::jsonb`, parameterised with `sql` and `JSON.stringify`, scoped by `orgId` and `conversationId`.
  - Inside `db.transaction`, `SELECT … FOR UPDATE` that row and re-check `expectState` against the run.
  - Write the patched `runs` array back.
  - Read the `messages` table name and the `runs` column from `src/models/Schema.ts` before writing the query.

- [ ] **Step 8: Run both test files.** Expected: PASS.

- [ ] **Step 9: Commit.** `feat(cards): a card run keeps what the card shows, and one call patches it`

---

### Task 2: Each connector's platform says how to connect it

**Files:**
- Modify: `src/libs/platforms/registry.ts` (`CredentialPlatform` at :144, and each platform with non-empty `connectorSlugs`)
- Test: `src/libs/platforms/howToConnect.test.ts` (create)

**Interfaces:**
- Produces, on `CredentialPlatform`:

<!-- eslint-skip -->
```ts
/**
 * How a person connects this platform (#1028). The Connectors form and the
 * chat card read this instead of special-casing providers.
 */
howToConnect?: {
  /** Present when a provider login can fetch the credential itself. */
  login?: {
    /** The connect provider that runs it (`libs/connect/registry.ts`). */
    provider: 'github' | 'atlassian' | 'slack';
    /** The access the login asks for, one line each, in the vendor's words. */
    access: readonly string[];
    /** True when logging in only grants the right to make a token, and a second call makes it. */
    createsTokenAfterLogin: boolean;
  };
  /** Pasting is always possible. What to paste, and where to get one by hand. */
  paste: {
    /** The kind of credential, named the way the vendor names it: "Personal access token", "API token", "Bot token". */
    credential: string;
    /** The access the pasted credential needs, one line each. */
    access: readonly string[];
    /** Where to make one by hand. Only a URL the vendor documents. Leave it out rather than guess. */
    getItAt?: { url: string; steps: readonly string[] };
  };
};
```

- Produces: `howToConnectFor(connectorSlug: string): CredentialPlatform['howToConnect'] | null`. It goes through `platformForConnectorSlug`.

- [ ] **Step 1: Write the failing tests.**
  1. Every platform with a non-empty `connectorSlugs` declares `howToConnect`.
  2. For every connector slug, `howToConnect.login` is set exactly when `providerForConnector(slug)` returns a provider, and `login.provider` equals that provider's `id`. This test is the guard that keeps the declaration and the registry from drifting.
  3. Every `getItAt.url` starts with `https://`.
  4. Atlassian's `login.access` equals `JIRA_READ_SCOPES`, and Slack's equals `SLACK_SOURCE_SCOPES`. Import both constants rather than copying them.

- [ ] **Step 2: Run it.** `npx vitest run src/libs/platforms/howToConnect.test.ts`. Expected: FAIL.

- [ ] **Step 3: Fill the declarations.**
  - **Only state what the code or the platform's existing `helpText` already states.**
  - `access` for a login comes from the provider's scope constants. GitHub's comes from the App's permissions as `exchange` records them; if the code doesn't name them, use `['The repositories you choose during install']`.
  - `paste.credential` and `paste.access` come from each platform's existing `label`, `fields` and `helpText`.
  - `getItAt` only where `helpText` already holds a URL, plus these three, which the vendors document:
    - GitHub: `https://github.com/settings/personal-access-tokens/new`
    - Jira: `https://id.atlassian.com/manage-profile/security/api-tokens`
    - Slack: `https://api.slack.com/apps`
  - Set `createsTokenAfterLogin: false` for all three real providers. GitHub mints installation tokens per call, which is not a person-facing second step.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(connect): each connector's platform declares how to connect it`

---

### Task 3: A login is a row in the credential store

**Files:**
- Create: `migrations/0166_api_token_login.sql`, plus an entry in `migrations/meta/_journal.json` (copy the shape of the 0165 entry: next `idx`, a `when` later than 0165's)
- Modify: `src/models/Schema.ts` (`apiTokenSchema` at :3206)
- Modify: `src/services/ApiTokenService.ts`
- Test: `src/services/ApiTokenService.login.test.ts` (create), `src/models/apiTokenLoginMigration.test.ts` (create; copy `src/models/projectOnboardingMigration.test.ts`)

**Interfaces:**
- Migration:

<!-- eslint-skip -->
```sql
-- A login (OAuth grant or app install) is stored where a pasted key is (#1028).
-- `obtained_via` says which; `account` is the non-secret identity the login
-- belongs to (a GitHub org, an Atlassian site, a Slack team), used to keep one
-- row per account across re-logins. Replay-safe: every deploy re-runs this file.
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "obtained_via" text DEFAULT 'paste' NOT NULL;
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN IF NOT EXISTS "account" text;
```

- Schema: `obtainedVia: text('obtained_via').default('paste').notNull().$type<'paste' | 'login'>()` and `account: text('account')`.
- Produces:

<!-- eslint-skip -->
```ts
export type StoredLogin = { id: string; replacedIds: string[]; rotated: boolean };
/**
 * Store a provider login's credential bag (#1028).
 * - Same platform and account already live (re-login): rotate that row's values in place, keep its id.
 * - One-live platform with another live row: revoke it and insert; its id is in `replacedIds`.
 * - Otherwise: insert.
 * One transaction. Never validates against `fields`: a login bag is the provider's, not a paste.
 */
export async function storeLoginCredential(input: {
  orgId: string; platform: CredentialPlatformId; name: string; account: string;
  values: Record<string, unknown>; createdBy: string; tx?: DbTransaction;
}): Promise<StoredLogin>;

/**
 * Write a refreshed login bag back to the same row. Compare-and-swap: writes only
 * while the stored bag's `refreshToken` still equals `expectedRefreshToken`.
 * Returns false when the row is gone, revoked, not a login, or the swap lost.
 */
export async function updateLoginCredentialValues(input: {
  orgId: string; tokenId: string; values: Record<string, unknown>; expectedRefreshToken: string;
}): Promise<boolean>;
```

- `TokenSummary` gains `obtainedVia: 'paste' | 'login'` and `account: string | null`. `revealable` is false for login rows: a login's tokens are never shown.
- `resolveCredentialById` stamps `lastUsedAt` when it is null or more than an hour old. That is one conditional `UPDATE`, so a hot path doesn't write on every call.

- [ ] **Step 1: Write the failing migration test** (PGlite, like `projectOnboardingMigration.test.ts`):
  - an existing `api_token` row reads `obtained_via = 'paste'` and `account = null` after the file runs
  - running the file twice is harmless

  Create the minimal `api_token` table in `beforeEach`.

- [ ] **Step 2: Write the failing service tests** (`vi.mock('@/libs/DB')`):
  1. A first Slack login inserts a row with `obtainedVia: 'login'`, `account: 'Northwind'` and `platform: 'slack'`. `listTokens` shows it with `revealable: false`.
  2. A second Slack login with the same account returns `rotated: true` and the same id. The row count for the platform is still 1, and `resolveCredentialById` returns the new bag.
  3. A Slack login for a different account inserts a second row (`slack` is a many-platform).
  4. A GitHub login while a pasted GitHub row is live revokes the pasted row and returns its id in `replacedIds`.
  5. `updateLoginCredentialValues` with the right `expectedRefreshToken` returns true and the row holds the new bag. With a stale one, it returns false and the row is unchanged.
  6. `resolveCredentialById` sets `lastUsedAt` on first use, and doesn't change it on a second call within the hour. Use `vi.setSystemTime`.

- [ ] **Step 3: Run them.** `npx vitest run src/models/apiTokenLoginMigration.test.ts src/services/ApiTokenService.login.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement.**
  - Write the migration and the journal entry.
  - Add the Schema columns.
  - Add `storeLoginCredential`, reusing the vault and the id generator from `storePlatformKey` at :301.
  - Find the re-login row by `(orgId, platform, account, obtainedVia='login', revokedAt is null)`.
  - `keyHint` is `keyHint(value)` of the bag's `token` or `accessToken` when one is a string. Otherwise it is `'login'`.
  - Add `updateLoginCredentialValues`. Decrypt, compare `refreshToken`, re-encrypt, and write with `WHERE ciphertext = <the ciphertext read>`. That is the same compare-and-swap as `updateCredentialValuesForConnector` at `SourceCredentialService.ts:189`. Read it and mirror it.
  - Extend `TokenSummary` and `listTokens`.
  - Add the `lastUsedAt` stamp.
  - **Before writing**, check `api_token_shape_ck` (`Schema.ts:3285`) and the `api_token_platform_immutable_tg` trigger. A login row must satisfy the supplied-key shape: ciphertext set, `secretHash` null.

- [ ] **Step 5: Run them.** Expected: PASS. Then run `npx vitest run src/services/ApiTokenService` to cover the existing token tests. Expected: PASS.

- [ ] **Step 6: Run** `npm run check:migrations` from `packages/core`. Expected: it lists 177 files and reports no blocking index builds.

- [ ] **Step 7: Commit.** `feat(credentials): a login is a row in the workspace credential store`

---

### Task 4: Connect attempts are recorded, with their date

**Files:**
- Create: `src/libs/connect/attempts.ts`
- Test: `src/libs/connect/attempts.test.ts`

**Interfaces:**
- Produces:

<!-- eslint-skip -->
```ts
export type ConnectAttempt = { connector: string; provider: string; ok: boolean; reason: string | null; at: Date; userId: string | null };
/** Write one attempt to `source_audit` (`connected` or `failed_auth`), with the provider and connector in metadata. */
export async function recordConnectAttempt(input: { orgId: string; userId: string; provider: string; connector: string; ok: boolean; reason?: string; tx?: DbTransaction }): Promise<void>;
/** The newest attempt per connector for a workspace. One query: DISTINCT ON (metadata->>'connector') ordered by at desc. */
export async function lastConnectAttempts(orgId: string): Promise<Map<string, ConnectAttempt>>;
/**
 * A failed attempt in a person's words, with its date: "Last attempt Oct 1, 4:12 PM: GitHub denied access".
 * Formatted in the given IANA time zone (default 'UTC'), so the server and the browser agree.
 */
export function describeLastAttempt(attempt: { at: Date; reason: string | null; providerLabel: string }, timeZone?: string): string;
/** The reason part alone: "GitHub denied access". */
export function connectFailureSummary(providerLabel: string, reason: string | null): string;
```

- Reason wording (`connectFailureSummary`). Keep the reason codes the callback emits today (see `callback/route.ts` and the provider refusal lists):

| reason | summary |
|---|---|
| `access_denied`, `cancelled` | `<Label> denied access` / `The <Label> login was cancelled` |
| `state_expired` | `The login took longer than 10 minutes` |
| `not_admin` | `Only a workspace admin can connect <Label>` |
| `wrong_person`, `wrong_workspace` | `The login was started by someone else or in another workspace` |
| `store_failed` | `<Label> logged in, but the credential couldn't be saved` |
| `token_step_failed:<what>` | `<Label> logged in, but <what> is still missing` |
| anything else | `<Label> refused the login (<reason>)` |

- [ ] **Step 1: Write the failing tests.**
  - `describeLastAttempt({at: new Date('2026-10-01T16:12:00Z'), reason: 'access_denied', providerLabel: 'GitHub'}, 'UTC')` is exactly `Last attempt Oct 1, 4:12 PM: GitHub denied access`.
  - The same instant in `America/New_York` reads `12:12 PM`.
  - Each row of the table above has a case.
  - For PGlite: two attempts for `github` and one for `slack` give a two-entry map, holding the newer GitHub attempt and the Slack one. Another org's attempts are excluded.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** `source_audit` columns are at `Schema.ts:2638`. `installId` is nullable. Format the date with `Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone })`.

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(connect): every connect attempt is recorded with its date and reason`

---

### Task 5: Log in first, then save the source

**Files:**
- Modify: `src/libs/connect/state.ts` (payload)
- Modify: `src/libs/connect/provider.ts` (an optional `finish` hook on `ConnectProvider`)
- Modify: `src/libs/connect/returnTo.ts` (`connectStartHref` and `returnUrl` take a connector)
- Modify: `src/app/api/connect/[provider]/start/route.ts`
- Modify: `src/app/api/connect/[provider]/callback/route.ts` (thin; the logic moves to a service)
- Create: `src/services/connect/completeLogin.ts`
- Test: `src/services/connect/completeLogin.test.ts`, `src/libs/connect/state.test.ts` (extend), `src/libs/connect/returnTo.test.ts` (extend)

**Interfaces:**
- State payload: `{ v: 1; provider; orgId; userId; nonce; exp; returnTo?; sourceSlug?: string; connectorSlug?: string; conversationId?: number; cardId?: string }`.
  - `verifyState` refuses `malformed` when neither `sourceSlug` nor `connectorSlug` is present.
  - A state signed before this change (it has `sourceSlug` only) still verifies. Its 10-minute TTL spans a deploy.
- `ConnectProvider.finish?: (credentials: RawCredentials) => Promise<{ ok: true; credentials: RawCredentials } | { ok: false; missing: string }>`. This is the second step for a login that only grants the right to make a token. No real provider sets it yet (Task 2: all three are `createsTokenAfterLogin: false`). The scripted double in Task 10 exercises it.
- Start route: `GET /api/connect/<provider>/start?connector=<slug>|source=<slug>&returnTo=&conversation=<id>&card=<id>`.
  - With `connector`, it checks `providerForConnector(connector)?.id === provider.id` (400 otherwise). No source row is needed.
  - `conversation` must be a positive integer and `card` must match `/^[\w-]{1,64}$/`. Otherwise both are dropped.
- `connectStartHref(input: { provider: string; connector?: string; source?: string; returnTo: string | null; conversationId?: number; cardId?: string }): string`. Update the one existing caller (`offerConnection.ts` imports `connectHref`; grep for `connectStartHref`).
- Produces:

<!-- eslint-skip -->
```ts
export type LoginOutcome = { ok: true; tokenId: string; linkedSourceIds: number[] } | { ok: false; reason: string };
/**
 * Everything after the vendor said yes (#1028), in one transaction:
 * 1. run the provider's `finish` step when it has one;
 * 2. store the bag with `storeLoginCredential` (platform from `platformForConnectorSlug(connector)`;
 *    account = `provider.summarize(bag)?.account ?? displayName`);
 * 3. link sources: the named source (when the login started from one) always; every other source of
 *    this connector whose `api_token_id` is null, is in `replacedIds`, or points at a login row of
 *    the same platform and account. A source on a pasted token the person chose keeps it;
 * 4. record the attempt (ok);
 * 5. when the login came from a chat card, mark it decided:
 *    `{action: 'approve', at: now, by: userId}` with `expectState: 'proposed'`.
 * No `source_credential` row is written.
 */
export async function completeLogin(input: {
  orgId: string; userId: string; provider: ConnectProvider; connectorSlug: string; sourceSlug?: string;
  exchanged: { credentials: RawCredentials; displayName: string };
  card?: { conversationId: number; cardId: string };
}): Promise<LoginOutcome>;

/** A refused or failed login: record the attempt and put it on the card. The card stays `proposed`: a failed login is not a rejection. */
export async function recordFailedLogin(input: {
  orgId: string; userId: string; provider: ConnectProvider; connectorSlug: string; reason: string;
  card?: { conversationId: number; cardId: string };
}): Promise<void>;
```

- Callback, after this task:
  1. The checks stay in today's order. When the state has a `sourceSlug`, `findSourceBySlug` still gates with `source_missing`.
  2. `connectorSlug` = `payload.connectorSlug ?? source.connectorSlug`.
  3. `exchange`.
  4. On a refusal: `recordFailedLogin`, then land.
  5. Otherwise: `completeLogin`. On `ok: false`, call `recordFailedLogin` with its reason, then land.
  6. Land with `connect=ok&connector=<slug>` (and `source=<slug>` when there was one).
  - `recordFailedLogin` runs only after the state's org, person and admin checks pass. A crafted state never writes an attempt.
  - `land` becomes a module-level `landAt(request, origin, outcome, params)`.
- `returnUrl` and `connectReturnPrompt` learn `connector`. "I connected GitHub" works without a `source`.

- [ ] **Step 1: Write the failing `state` and `returnTo` tests.**
  - A connector-only payload round-trips.
  - A payload with neither slug is `malformed`.
  - An old sourceSlug-only payload still verifies.
  - `connectStartHref({provider:'github', connector:'github', returnTo:'/dashboard/chat?conversation=7', conversationId:7, cardId:'card_1'})` equals `/api/connect/github/start?connector=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D7&conversation=7&card=card_1`.
  - `connectReturnPrompt({connect:'ok', connector:'github'})` mentions GitHub.

- [ ] **Step 2: Write the failing `completeLogin` / `recordFailedLogin` tests** (PGlite). Use a stub `ConnectProvider` object in the test file: `id: 'github'`, `summarize: () => ({ account: 'northwind (organization)' })`, `exchange` unused. Each test is a business rule:
  1. **Grant-first.** No GitHub source exists. `completeLogin` returns `ok`. One `api_token` row has `platform: 'github'` and `obtainedVia: 'login'`. Zero `source_credential` rows exist.
  2. **It links the right sources.**
     - A GitHub source with a null link gets linked.
     - A GitHub source on a pasted row, which this login replaces (one-live), gets relinked to the new row.
  3. **A pasted Jira row the person chose survives a Jira login for another account.** Seed a source linked to a pasted Jira row. After the login, it still points at the pasted row.
  4. **The card is approved by the person who logged in.** Seed a conversation with a proposed link card `card_1`. After `completeLogin(… card)`, the run has `state: 'decided'` and `decision.by === userId`.
  5. **A failed login is not a rejection.** `recordFailedLogin(reason: 'access_denied', card)` leaves the card `proposed`. The card gains `lastAttempt.summary === 'GitHub denied access'`. `lastConnectAttempts` holds a not-ok attempt.
  6. **The second step.** A stub with `finish` returning `{ok:true, credentials:{...bag, token:'made-after'}}` stores the finished bag. A stub returning `{ok:false, missing:'an API token'}` stores nothing and returns `{ok:false, reason:'token_step_failed:an API token'}`.
  7. **All or nothing.** If linking throws (force it with a source id that no longer exists, or `vi.spyOn` a db call), no `api_token` row remains.

- [ ] **Step 3: Run them.** `npx vitest run src/services/connect/completeLogin.test.ts src/libs/connect/state.test.ts src/libs/connect/returnTo.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement** the state, `finish`, `returnTo`, start route, `completeLogin`, `recordFailedLogin`, and the thin callback.
  - Remove the `storeCredentialForSource` and `clearLinkedCredential` calls from the callback. Leave `clearLinkedCredential` itself in place if anything else uses it (grep). Knip fails on a dead export, so delete it only when it is truly unused.
  - Rewrite the callback's header comment: the grant is now an `api_token` row, not the install.

- [ ] **Step 5: Run them.** Expected: PASS. Then run `npx vitest run src/libs/connect src/app/api/connect`. Expected: PASS.

- [ ] **Step 6: Commit.** `feat(connect): log in first, store the login in the credential store, link the connector's sources`

---

### Task 6: A refreshed token updates the same row

**Files:**
- Modify: `src/services/SourceCredentialService.ts:189` (`updateCredentialValuesForConnector`), or the Jira persistence call site in `src/libs/sources/jira.ts:~226-280`, whichever keeps the read and the write on the same row (read both first)
- Test: `src/libs/sources/jira.refresh.test.ts` (extend if present, else create)

**Interfaces:**
- Consumes: `updateLoginCredentialValues` (Task 3).
- Rule: **the write-back goes to the row the grant was read from.** When the Jira source resolves through `api_token_id` to a login row, the refresh calls `updateLoginCredentialValues` on that row. Otherwise it keeps today's `source_credential` write.

- [ ] **Step 1: Write the failing test.**
  - Seed a Jira source linked to a login `api_token` row whose bag holds an expired `accessToken` and `refreshToken: 'r1'`.
  - Stub `fetch`: the Atlassian token URL returns `{access_token:'a2', refresh_token:'r2', expires_in:3600}`, and the Jira call returns 200 `{values:[], isLast:true}`.
  - Make one Jira request through `resolveJiraAuth(... persistence: {kind:'persist', orgId, warn})` and `jiraFetch`.
  - Assert three things:
    - the same `api_token` row now holds `refreshToken: 'r2'`
    - the `api_token` row count is unchanged
    - no `source_credential` row was written
  - Second case: the swap lost. Change the stored `refreshToken` to `'r9'` between the read and the write by stubbing. Assert the row keeps `'r9'` and `warn` was called.

- [ ] **Step 2: Run it.** Expected: FAIL. Today the write goes to `source_credential` and returns false.

- [ ] **Step 3: Implement the smallest change that routes the write by where the read came from.**

- [ ] **Step 4: Run it.** Expected: PASS. Then run `npx vitest run src/libs/sources/jira src/services/tracker`. Expected: PASS.

- [ ] **Step 5: Commit.** `fix(credentials): a refreshed login writes back to its own row`

---

### Task 7: Move existing logins into the credential store, once

**Files:**
- Modify: `src/services/ConnectorCredentialBackfill.ts` (or create `src/services/connect/moveLogins.ts` if the backfill's per-platform field rules don't fit a login bag; read it first and record the choice as a Ruling)
- Modify: `package.json` scripts (`connectors:move-logins` if it's a new script; copy the `connectors:backfill-credentials` line, :73)
- Create (if new): `src/scripts/move-connector-logins.ts`
- Test: `src/services/connect/moveLogins.test.ts`

**Interfaces:**
- Produces: `moveLoginsToCredentialStore(): Promise<{ moved: Array<{ orgId: string; connector: string; tokenId: string; linkedSourceIds: number[] }>; skipped: Array<{ orgId: string; connector: string; why: string }> }>`.
- Rule:
  - For each enabled `source_install` whose connector has a connect provider (`providerForConnector`), take the newest live `source_credential`.
  - When `provider.summarize(bag)` is non-null (it is a login bag), call `storeLoginCredential`. It reuses a live login row with the same account, so a re-run inserts nothing.
  - Then link every source of that connector whose `api_token_id` is null.
  - **The `source_credential` row is left in place**, so a bad move is undone by clearing `api_token_id`.
  - A bag `summarize` can't read is skipped with a reason.
  - The script exits 2 when anything was skipped, like the existing backfill.

- [ ] **Step 1: Write the failing tests** (PGlite).
  1. One org has a GitHub install with a login bag and two GitHub sources with null links. After the move, there is one login row, both sources are linked, and the `source_credential` row is still there and still live.
  2. A second run moves nothing: `moved` is empty and the row count is unchanged.
  3. A source already linked to a pasted Jira row is not relinked.
  4. An unreadable bag shows up in `skipped` with the connector named.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** Build the source bag with the existing `storeCredential` / `storeCredentialForSource` helpers so the encryption path is the real one.

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(credentials): a one-time move puts existing logins in the credential store`

---

### Task 8: See what a login can reach

**Files:**
- Modify: `src/libs/connect/provider.ts` (an optional `browse` on `ConnectProvider`)
- Create: `src/libs/connect/browse.ts` (types, plus `browseConnection`, the one entry point)
- Modify: `src/libs/connect/providers/github.ts`, `atlassian.ts`, `slack.ts` (implement `browse`)
- Modify: `src/libs/sources/slack.ts` (export `memberChannels`, add a `signal` parameter)
- Modify: `src/libs/connect/providers/github.ts` `installationRepositories` (add an optional `signal`)
- Create: `src/app/[locale]/rpc/connectors/[slug]/browse/route.ts` (admin-only POST, copying the auth shape of `…/inspect/route.ts`)
- Create: `src/services/agents/tools/browseConnection.ts`, registered where `offer_connection` is registered (grep `offerConnectionTool`)
- Test: `src/libs/connect/browse.test.ts`, `src/services/agents/tools/browseConnection.test.ts`, `src/app/[locale]/rpc/connectors/[slug]/browse/route.test.ts`

**Interfaces:**

<!-- eslint-skip -->
```ts
export const BROWSE_LISTS = ['repos', 'sites', 'projects', 'statuses', 'channels'] as const;
export type BrowseList = (typeof BROWSE_LISTS)[number];
export type BrowseRequest = { list: BrowseList; query?: string; site?: string; project?: string; limit: number /* 1–50 */ };
export type BrowseItem = { id: string; label: string; detail?: string };
export type BrowseResult =
  | { ok: true; list: BrowseList; account: string; items: BrowseItem[]; total: number; truncated: boolean }
  | { ok: false; reason: 'not_logged_in' | 'unsupported' | 'unauthorized' | 'unreachable'; message: string };

/** ConnectProvider.browse: what lists it serves, and how. */
browse?: { lists: readonly BrowseList[]; run: (credentials: RawCredentials, request: BrowseRequest) => Promise<BrowseItem[]> };

/**
 * One way to read what a workspace's login for a connector can see.
 * Uses the newest live `api_token` row of the connector's platform (Task 3). Filters by `query`
 * (case-insensitive substring on id and label), caps at `limit`, and never throws:
 * vendor errors become `unauthorized` / `unreachable` with a sentence for a person.
 */
export async function browseConnection(input: { orgId: string; connectorSlug: string; request: BrowseRequest }): Promise<BrowseResult>;
```

- Provider lists:
  - **github `repos`:** `installationRepositories(await resolveGithubToken(bag), baseUrl, signal)`. `id` = `label` = `owner/name`.
  - **atlassian `sites`:** from `bag.sites`, `{id: site.url, label: site.name, detail: site.url}`.
  - **atlassian `projects`:** `GET /rest/api/3/project/search?maxResults=50&query=<query>` on the site (`site` or the only site). Build auth with `resolveJiraAuth({ baseUrl: site.url, credentials: bag, persistence: { kind: 'persist', orgId, warn } })`. Items are `{id: key, label: name}`.
  - **atlassian `statuses`:** `GET /rest/api/3/project/{project}/statuses`, flattened across issue types and deduped by name. `detail` = the status category name ("To Do", "In Progress", "Done").
  - **slack `channels`:** `memberChannels(baseUrl, {Authorization: 'Bearer <token>'}, true)`. Items are `{id, label: '#'+name}`.
- Every vendor call passes `signal: AbortSignal.timeout(15_000)`.
- Agent tool `browse_connection`:
  - Input: `{ connector: string; list: BrowseList; query?: string; site?: string; project?: string; limit?: number /* default 20 */ }`.
  - **Admin-only**, using the same check as `offerConnection` (`memberWorkspace(...).accountRole === 'admin'`), wrapped in try/catch. A lookup failure returns a refusal sentence, not a raw error (fixes the deferred minor from PR #1069 for this tool).
  - Returns compact text, one item per line (`- <id> — <label> (<detail>)`), headed `<Connector> as <account>: <n> of <total> <list>` with `(narrow with query)` when truncated.
  - Description, verbatim: `Read what this workspace's login to a connector can see — the code host's repos, the tracker's sites, projects and statuses, the chat workspace's channels — so the next question can offer real choices. Admins only; reads only.`
- RPC route: `POST /rpc/connectors/<slug>/browse` with `{list, query?, site?, project?, limit?}`, returning a `BrowseResult`. Admin-only, 403 otherwise.

- [ ] **Step 1: Write the failing `browse.test.ts`.** Stub `fetch` and seed login rows with `storeLoginCredential`.
  1. GitHub repos: the stub serves two pages. `query: 'portal'` returns only matches, and `total` counts all matches before the cap.
  2. Atlassian statuses dedupe across issue types and carry their category.
  3. **Not logged in:** no row gives `{ok:false, reason:'not_logged_in'}` with a message naming the connector.
  4. **Vendor 401** gives `unauthorized`. **Timeout:** the stub rejects with `DOMException('…','TimeoutError')`, which gives `unreachable`. Neither throws.
  5. A list the provider doesn't serve (`channels` on GitHub) gives `unsupported`.
  6. **Every vendor fetch carries an AbortSignal.** Assert `init.signal` is defined on each stubbed call.

- [ ] **Step 2: Write the failing tool and route tests.**
  - The tool refuses a member with a readable sentence, and refuses when the membership lookup throws.
  - The tool's text for 25 repos with `limit: 20` says `20 of 25` and `narrow with query`.
  - The route returns 403 for a member and 200 with a `BrowseResult` for an admin.

- [ ] **Step 3: Run them.** Expected: FAIL.

- [ ] **Step 4: Implement.**

- [ ] **Step 5: Run them.** Expected: PASS.

- [ ] **Step 6: Commit.** `feat(connect): read what a login can see, for the agent and the Connectors form`

---

### Task 9: Save a source from what the person picked

**Files:**
- Create: `src/libs/actions/source-connect.ts`
- Modify: `src/libs/actions/registry.ts` (`registerAction(sourceConnectAction)` beside `workspaceDescribeAction` at :159)
- Test: `src/libs/actions/source-connect.test.ts`

**Interfaces:**

<!-- eslint-skip -->
```ts
export const sourceConnectInput = z.object({
  connector: z.string().min(1),
  /** The connector's own config, checked against its `configSchema`: `{repos}` for GitHub, `{baseUrl, projectKeys}` for Jira. */
  config: z.record(z.string(), z.unknown()),
});
/** id 'source.connect', grant 'manage_sources', external false. */
export const sourceConnectAction: Action<typeof sourceConnectInput>;
```

- `precheck`:
  - Refuses `Log in to <Label> first` when the platform has no live `api_token` row.
  - Refuses `<Label> isn't a connector this workspace can add` for an unknown connector.
- `execute`:
  - Refuses `Only a workspace admin can connect a source` unless `ctx.reviewedBy ?? ctx.invokedBy` is an admin.
  - Calls `addSource({orgId, kind: connector, configJson: config})`. A ZodError becomes a refusal naming the bad field.
  - Then links the new source's `api_token_id` to the newest live row of the platform.
  - When `addSource` finds the slug already exists (`ensureSource` is find-or-insert), it replaces that row's config with the validated one and returns `created: false`, `before: <old config>`.
  - Returns `{ sourceId, slug, created, before? }`.
- `undo`:
  - A created source that has never synced (`lastSyncedAt` null) is deleted.
  - An updated source gets its `before` config back.
  - A created source that has synced since is refused with `It has synced since; remove it from Connectors instead`.
- `dedupKeyFor`: `source.connect:<connector>:<stable JSON of config>`.
- `reviewCard`: title `Connect <Label>`, plus a field per config key, for example `Repositories: northwind/portal`.

- [ ] **Step 1: Write the failing tests** (PGlite):
  1. With a GitHub login row, executing `{connector:'github', config:{repos:['northwind/portal']}}` creates one source whose `api_token_id` is the login row and returns `created: true`.
  2. Without a login, `precheck` returns `Log in to GitHub first`.
  3. `{repos: []}` is refused, naming `repos`.
  4. A member as `reviewedBy` is refused, and no source exists afterwards.
  5. Running the same input twice leaves one source. The second run returns `created: false`.
  6. Undo of a fresh source deletes it. Undo after `lastSyncedAt` is set is refused.
  7. **Nothing syncs inline.** Executing makes no `fetch` call. Assert the stubbed global `fetch` was never called.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** Read `workspace-describe.ts` for the shape. Find the admin lookup in `offerConnection.ts`.

- [ ] **Step 4: Run them.** Expected: PASS. Then run `npx vitest run src/libs/actions/registry`. Expected: PASS. A registry snapshot of action ids may need the new id added.

- [ ] **Step 5: Commit.** `feat(connect): source.connect saves a source from the person's pick, on their login`

---

### Task 10: A scripted stand-in for the providers, for e2e

**Files:**
- Create: `src/libs/connect/scripted.ts`
- Modify: `src/libs/connect/registry.ts` (`providerFor` / `providerForConnector` / `connectProviders` return scripted providers when enabled)
- Test: `src/libs/connect/scripted.test.ts`

**Interfaces:**
- Env, mirroring the scripted model (`src/libs/llm/scripted.ts`; read its production guard and copy it):
  - `VOCION_CONNECT_SCRIPT=<path to json>` turns it on.
  - It is refused (throws at first use) when `NODE_ENV === 'production'`, unless `VOCION_ALLOW_SCRIPTED_CONNECT=1`.
- Script shape:

<!-- eslint-skip -->
```json
{
  "providers": {
    "github": { "outcome": "ok", "displayName": "GitHub — northwind", "credentials": { "installationId": 1, "account": "northwind", "accountType": "Organization", "repositorySelection": "selected", "repositories": ["northwind/portal", "northwind/api"] } },
    "slack": { "outcome": "refuse", "reason": "access_denied" }
  },
  "browse": {
    "github": { "repos": [{ "id": "northwind/portal", "label": "northwind/portal" }] },
    "atlassian": { "sites": [], "projects": [], "statuses": [] }
  }
}
```

- The scripted provider keeps the real provider's `id`, `label`, `connectorSlugs` and `summarize`. It overrides:
  - `configured: () => true`
  - `authorizeUrl: ({state, redirectUri}) => \`${redirectUri}?state=${encodeURIComponent(state)}&code=scripted\``, so the browser goes straight back to the callback
  - `exchange`, returning the script's outcome
  - `browse.run`, returning the script's list for that provider and list (empty when absent)
  - `finish`, only when the script sets `"finish": {"outcome":"ok","add":{...}}` or `{"outcome":"missing","missing":"…"}`
- A provider absent from the script keeps its real behaviour, except that `exchange` refuses with `not_scripted`. That way a test can never reach a real vendor.

- [ ] **Step 1: Write the failing tests.**
  - With `NODE_ENV=production` and no allow flag, `providerFor('github')` throws a message naming `VOCION_ALLOW_SCRIPTED_CONNECT`.
  - With the script above, `exchange` for GitHub returns the bag, and for Slack returns `{ok:false, reason:'access_denied'}`.
  - `authorizeUrl` points at the callback.
  - Browse returns the script's repos.
  - Atlassian, which is absent from `providers`, refuses `not_scripted`.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** Read the script once per process and cache it, like `loadScript` in `scripted.ts`.

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit.** `test(connect): a scripted stand-in for the connect providers, refused in production`

---

### Task 11: The chat card starts the login

**Files:**
- Modify: `src/services/agents/tools/offerConnection.ts`
- Modify: `src/features/dashboard/chat/RecommendedActionCard.tsx` (link-card branch at ~:455 and :619-631)
- Test: `src/services/agents/tools/offerConnection.test.ts` (extend), `src/features/dashboard/chat/RecommendedActionCard.link.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1 card fields, Task 2 `howToConnectFor`, Task 4 `lastConnectAttempts` and `describeLastAttempt`, Task 5 `connectStartHref`.
- `offer_connection` behaviour:
  - **Login-capable connector, no live login row:**
    - Card title `Connect <Label>`, `hrefLabel` `Connect <Label>`.
    - `href` = `connectStartHref({provider, connector, returnTo: '/dashboard/chat?conversation=<id>', conversationId, cardId})`.
    - `secondaryHref` `/dashboard/connectors?add=<slug>&paste=1&returnTo=<same>`, `secondaryHrefLabel` `Paste a token`.
    - `body` = `howToConnect.login.access` joined as `Asks for: …`.
    - `lastAttempt` set from `lastConnectAttempts` when the newest attempt for this connector failed.
  - **Login-capable connector, already logged in, no source:** no card. It returns `Already logged in to <Label> as <account>. Call browse_connection to offer what it can see, then save the pick with source.connect.`
  - **Connector without a login provider:** today's Connectors link, with `hrefLabel` `Connect <Label>`.
  - **Never** says "Approve".
- The card UI for a link card:
  - **Proposed:** the primary button is a plain `<a>`, not `next/link`, because it goes to an API route that redirects. Next to it sits the secondary link. When `lastAttempt` is set, the primary label is `Try again` and the line `describeLastAttempt(...)` sits under the buttons, formatted in the browser's time zone.
  - **Decided:** the card collapses to `✓ Connected <Label>`, with no buttons.

- [ ] **Step 1: Write the failing tool tests.**
  1. The admin, no-login case emits a card whose `href` starts `/api/connect/github/start?connector=github` and carries `card=<the card's own id>` and `conversation=<id>`, and whose `secondaryHrefLabel` is `Paste a token`.
  2. A failed attempt recorded earlier puts `lastAttempt` on the card.
  3. With a live login row, no card is emitted and the text names `browse_connection`.
  4. A member gets a refusal and no card.

- [ ] **Step 2: Write the failing card tests (RTL).**
  - A proposed link card with `lastAttempt` renders a `Try again` link to the start href, a `Paste a token` link, and the text `Last attempt Oct 1, 4:12 PM: GitHub denied access`. Pin the time zone by passing it in, or mock `Intl`.
  - A decided card renders `Connected GitHub` and no links.
  - No rendered text matches `/approve/i`.

- [ ] **Step 3: Run them.** Expected: FAIL.

- [ ] **Step 4: Implement.**

- [ ] **Step 5: Run them.** Expected: PASS.

- [ ] **Step 6: Commit.** `feat(connect): the chat card runs the login; a failed one shows its dated last attempt`

---

### Task 12: The Connectors page offers login or paste

**Files:**
- Modify: `src/features/dashboard/SourcesPanel.tsx` (the add-source form; `updateSourceConfig` at :1114 is the existing save)
- Modify: the Connectors page server component, which passes `lastConnectAttempts` and `howToConnect` (grep `SourcesPanel` under `src/app/[locale]/(auth)/dashboard/connectors`)
- Test: `src/features/dashboard/SourcesPanel.connect.test.tsx` (create)

**Interfaces:**
- Consumes: Tasks 2, 4, 5 and 8 (the browse RPC route), and the `POST /rpc/sources` create.
- Behaviour:
  1. **Every connector card has a `Connect` button.**
  2. **Login-capable connector, with no live login:**
     - The form shows `Log in with <provider label>` as a plain `<a>` to `connectStartHref({provider, connector, returnTo:'/dashboard/connectors?add=<slug>'})`.
     - Beside it is a `Paste a token instead` checkbox. Checked, it shows today's paste fields, `paste.credential`, `paste.access` and the `getItAt` link with its steps.
     - `?paste=1` pre-checks it.
  3. **After login** (`?add=<slug>&connect=ok&connector=<slug>`, or any time a live login row exists):
     - The form shows `Logged in as <account>`.
     - The list-valued config field (`repos` for GitHub, `projectKeys` for Jira, after picking the site for `baseUrl`) offers checkboxes from the browse RPC, with a filter box that re-queries `query`.
     - Save creates the source through the existing `POST /rpc/sources`, then links `api_token_id`. Use `linkSourceToStoredCredential` (`SourceCredentialService.ts:321`) through whatever route the panel already uses to link a pasted token; read it first.
  4. **Last attempt line:** under each connector with a failed newest attempt, `describeLastAttempt(...)`.
  5. **The declaration drives the form.** No `if (slug === 'github')` branches for login or paste. Read `howToConnect`.

- [ ] **Step 1: Write the failing RTL tests** (mock the client and `fetch`):
  1. GitHub's form, with no login, renders `Log in with GitHub` whose `href` starts `/api/connect/github/start?connector=github`, and an unchecked `Paste a token instead`. Checking it reveals the token field and the `https://github.com/settings/personal-access-tokens/new` link.
  2. HubSpot (no login provider) renders the paste fields only, with its declared `paste.credential` text.
  3. With a live GitHub login and the browse RPC returning two repos, the form shows `Logged in as northwind`. Ticking one and saving posts `configJson: {repos:['northwind/portal']}`.
  4. A failed Slack attempt renders `Last attempt Oct 1, 4:12 PM: Slack denied access` under Slack.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** SourcesPanel is large. Put new pieces in new components beside it (`ConnectByLogin.tsx`, `BrowsePicker.tsx`, `LastAttemptLine.tsx`) rather than growing the file.

- [ ] **Step 4: Run them.** Expected: PASS. Then run `npx vitest run src/features/dashboard/SourcesPanel`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(connect): the Connectors page offers login or paste, from each connector's declaration`

---

### Task 13: The Developers page shows logins

**Files:**
- Modify: `src/features/api-tokens/ApiTokensPanel.tsx`
- Test: `src/features/api-tokens/ApiTokensPanel.login.test.tsx` (create)

**Interfaces:**
- Consumes: `TokenSummary.obtainedVia` and `.account` (Task 3).
- Behaviour:
  - **Key cell for a login row:** `Login · <account>`, with no reveal button. The server already refuses a reveal; the UI hides the button.
  - **Revoke:** offered as for any row.
  - **Last used:** shown as for any row.

- [ ] **Step 1: Write the failing test.**
  - A list with one pasted row and one login row renders `Login · northwind` for the login row, with no Show button on it.
  - The pasted row keeps its hint and its Show button.

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(credentials): the Developers page lists logins beside pasted keys`

---

### Task 14: E2E: connect from the Connectors page

**Files:**
- Create: `e2e/connect/connect.spec.ts`, `e2e/connect/scripts/connect.json` (the Task 10 shape), `e2e/connect/support/seed.ts` (copy `e2e/onboarding/support/seed.ts`)
- Modify: `playwright.config.ts` (a `connect` project, copied from `onboarding`), and `package.json` (an `e2e:connect` script, copied from `e2e:onboarding`, with `VOCION_CONNECT_SCRIPT` set)
- Modify: the CI e2e matrix, if projects are listed there (grep `onboarding` under `.github/workflows` at the repo root)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the spec.**
  1. **GitHub.** Sign in as an admin and open `/dashboard/connectors`. Click `Connect` on GitHub, then `Log in with GitHub`. The scripted provider sends the browser straight to the callback. The page lands on `/dashboard/connectors?add=github&connect=ok…`.
     - It shows `Logged in as northwind`.
     - Tick `northwind/portal` and save.
     - The GitHub source appears.
     - `/dashboard/developers` lists a GitHub row reading `Login · northwind`.
  2. **Slack, refused.** Back on Connectors, click `Connect` on Slack, then `Log in with Slack`. The script refuses with `access_denied`.
     - The page lands with `connect=error`.
     - Under Slack, it reads `Last attempt <today's date>: Slack denied access`. Match `/Last attempt \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M: Slack denied access/`.
  3. **No real vendor.** Record every request the page makes (`page.on('request', …)` through a module-level helper, like `recordStartCall` in `e2e/onboarding/onboarding.spec.ts`). Assert none went to `github.com`, `api.github.com`, `slack.com` or `atlassian.com`.

- [ ] **Step 2: Run it** with the local recipe:
  - Start a fresh `pglite-server` on port 55439 with migrations.
  - Start `next dev -p 3008` with the scratch env, plus `VOCION_CONNECT_SCRIPT=e2e/connect/scripts/connect.json`.
  - Warm `/sign-in`, `/api/auth/csrf`, `/api/auth/session`, `/api/auth/providers` and `/dashboard/connectors`.
  - Run `npx playwright test --project=connect --workers=1` with `PLAYWRIGHT_SKIP_WEB_SERVER=1`.

  Expected: 1 passed. If it fails, debug with superpowers:systematic-debugging. Never loosen an assertion to pass.

- [ ] **Step 3: Run the earlier suites again.** `onboarding` and `chat-incomplete` must still pass, because Task 11 changed the connect card's `href`. Update `onboarding.spec.ts`'s href assertion to the new start-route form, which is a real behaviour change: the card now starts the login.

- [ ] **Step 4: Commit.** `test(connect): e2e: log in from the Connectors page, refuse a login, never reach a vendor`

---

## After the last task

- Run every gate from `packages/core` and paste the results into the ledger: `npm run check:types`, `npx vitest run`, `npm run check:migrations`, and lint on changed files. Then run `npm run check:deps` from the repo root.
- Read the whole diff (`git diff feat/issue-1028-workspace-onboarding...HEAD --stat`, then by file) for debug prints, dead exports, client names and nested functions.
- Then start `2026-10-02-setup-interview.md`.
