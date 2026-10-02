# Setup Interview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workspace setup feels like the Grok onboarding Jamie tested. It asks one question at a time as a choice card (A–D plus "Type your own answer"). It connects what each answer needs, then builds the next card from that connection's real data. For a software workspace, it ends with repos, the tracker project and the factory's rules saved where the factory reads them.

**Architecture:**
- **A new card kind, `choice`.** It replaces the unused `ask` stub. It carries 2–4 lettered options. An option may bind an action, so picking it is the person's approval of exactly that input; the server reads the binding from the persisted card, never from the browser.
- **Answers are user turns.** An answer travels through the normal chat stream route as a user turn, with a `card_answer` field. The server marks the card answered (compare-and-swap) and runs any bound action as the person, then hands the agent `Answered "<question>": <answer>` plus the action's outcome.
- **The procedure lives in code.** It is in `workspace_setup`'s step guide and the `ask_choice` tool. Product suggestions use a generic `objects.create_group` action, so core never names `product` or `repo`. Factory rules map onto things the factory already reads: a Jira source's intake statuses (read by a new factory automation) and the trust ladder, which setup may only lower, never raise.

**Tech Stack:** Next.js app router, oRPC, drizzle + Postgres (PGlite in tests), zod, LangChain tools, vitest, React Testing Library, Playwright with the scripted model and the scripted connect providers.

**Spec:** vocion-core issue #1028, sections "Product suggestions in chat", "The setup interview" and their acceptance criteria. The issue body is the binding authority.

**Depends on:** `2026-10-02-connect-from-chat.md`, all tasks complete:
- Task 1: card run fields and `markCardRun(…, tx?)`
- Task 8: `browse_connection`
- Task 9: `source.connect` and `createSourceOnLogin`
- Task 10: scripted connect providers
- Task 11: the connect card

**Branch / worktree:** same as the connect plan. Paths are relative to `packages/core/`.

## Global Constraints

Everything in the connect plan's Global Constraints applies verbatim: no client names, no live calls in tests, no nested functions, timeouts, never log a credential, dated wording, copy repo patterns, replay-safe migrations, `<!-- eslint-skip -->` before doc fences, the gates, the unit-test env, and commit trailers. In addition:

- **Core code never names `product` or `repo`.** Those are software-factory plugin types (spec, "It lives in the software-factory plugin"). Core actions take type slugs as input.
- **Autonomy is earned, not configured** (DESIGN-PRINCIPLES value 4). Setup may lower a trust rung (`AutonomyService.demote`, always allowed). It never raises one; `promote` throws `NOT_EARNED` without evidence, and setup must not work around that.
- **One question per turn, enforced in code.** A second `ask_choice` in one turn is refused.
- **Choice option ids are `A`, `B`, `C`, `D`, in order.** The UI shows the letter. The free-text answer is option id `other`.
- **The opener question, verbatim:** `What do you want me taking off your plate?`

## Review Focus

1. **A tampered answer.** A browser that posts `card_answer` with a card id from another conversation, an option id the card doesn't have, or a card already answered gets a 409/404. No bound action runs, and no agent turn starts (Task 3).
2. **A double tap.** Two answers to one card, sent at the same time, run the bound action at most once and start one agent turn (Task 3).
3. **A bound action that fails.** The card is still marked answered. The agent gets the failure text, explains it and offers choices. The person is never left with a spinner or a silent "Done" (Tasks 3 and 5).
4. **A reload mid-interview.** An answered card reloads collapsed to its answer, an open one reloads open, and a skipped one reloads as skipped (Tasks 1 and 4).
5. **Approving the same product card twice, or a product that already exists.** No duplicates; the second approval reports what already exists (Task 6).

---

### Task 1: The choice card kind

**Files:**
- Modify: `src/libs/cards/card.ts`: replace `registerCardKind({ kind: 'ask', renderer: 'ask' })` with the `choice` kind, and update the header comment's kind list
- Modify: `src/services/ConversationService.ts` (`ConversationRun` card arm), `src/services/chat/runCollector.ts` (`onCard`), `src/features/dashboard/chat/types.ts`, `src/features/dashboard/chat/useChatSession.ts` (hydrate and live event)
- Test: `src/libs/cards/card.test.ts` (extend), `src/services/chat/runCollector.test.ts` (extend)

**Interfaces:**

<!-- eslint-skip -->
```ts
export const ChoiceOptionSchema = z.object({
  /** 'A'–'D', in order. The UI shows the letter. */
  id: z.enum(['A', 'B', 'C', 'D']),
  label: z.string().min(1).max(120),
  description: z.string().max(200).optional(),
  /** Picking this option runs these actions as the person, in order: the pick is the approval of exactly these inputs. Amended 2026-10-02 from one action to a list, so one cleanup pick (Task 9) can approve several tracker changes. */
  actions: z.array(z.object({ actionId: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) })).min(1).max(20).optional(),
});
// On CardSchema:
options: z.array(ChoiceOptionSchema).max(4).optional(),
/** Whether the person may type their own answer (option id 'other'). Defaults to true for a choice card. */
allowOther: z.boolean().optional(),
/** The person's answer, once given. */
answer: z.object({ optionId: z.string(), text: z.string(), at: z.string(), by: z.string().optional() }).optional(),
```

- `choice` refine:
  - 2–4 options
  - ids exactly `A…` in order, with no gaps
  - no `actions` (a choice is decided by its options)
- The card run keeps `options`, `allowOther` and `answer`. The client `RecommendedAction` gets `options?`, `allowOther?` and `answer?`.
- `CardRunPatch` (connect plan Task 1) gains `answer`.

- [ ] **Step 1: Write the failing tests.**
  - `readCard` accepts a choice card with options A, B.
  - It rejects one option, five options, ids `A, C`, and a choice card with `actions`.
  - `cardKind('ask')` is undefined, so grep the package for any `'ask'` card-kind use first. There is none at plan time.
  - The collector keeps `options` (including bound `actions`), `allowOther` and `answer`.
  - `readCard` rejects an option with 21 bound actions.
- [ ] **Step 2: Run them.** `npx vitest run src/libs/cards/card.test.ts src/services/chat/runCollector.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(cards): a choice card: two to four lettered options, an optional bound action each`

---

### Task 2: `ask_choice`, one question per turn

**Files:**
- Create: `src/services/agents/tools/askChoice.ts`, registered beside `offer_connection` (grep `offerConnectionTool`)
- Test: `src/services/agents/tools/askChoice.test.ts`

**Interfaces:**
- Tool `ask_choice`. Input:

<!-- eslint-skip -->
```ts
z.object({
  question: z.string().min(3).max(160),
  hint: z.string().max(200).optional(),
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    description: z.string().max(200).optional(),
    action: z.object({ actionId: z.string().min(1), input: z.record(z.string(), z.unknown()) }).optional(),
  })).min(2).max(4),
  allowOther: z.boolean().default(true),
})
```

- Behaviour:
  - Letters options `A…D` in order.
  - **Checks each bound action now**, so a bad binding fails while the agent can still fix it:
    - `getAction(actionId)` exists, and `action.inputSchema.safeParse(input)` succeeds
    - when the action has a `precheck`, `precheck(ctx, input)` returns nothing
    - any failure returns `Option <letter> can't be offered: <reason>` with no card
  - Emits `{ kind: 'choice', title: question, body: hint, options, allowOther, actions: [], state: 'proposed', source: { agentSlug, tool: 'ask_choice' } }` through `ctx.emit({type:'card', card})`, the same path `offerConnection.ts` uses.
  - **One per turn.** A second call in the same turn returns `You already asked "<first question>" this turn. Stop and wait for the answer; ask the next question after it.` Track it on the per-turn runtime context: find where `ctx` is built per turn and whether it carries turn state. If not, key a module-level `WeakMap<RuntimeContext, string>` on the ctx object.
  - The result text the model sees: `Asked. Stop here: the person's answer arrives as their next message, as Answered "<question>": <answer>.`
- Description, verbatim: `Ask the person you're talking to one question, as a card with two to four lettered options built from what you already know, plus "Type your own answer". Use it for every setup question. An option can carry an action (actionId + input): picking it is the person's approval and runs it. One question per turn; end your turn after asking.`

- [ ] **Step 1: Write the failing tests.**
  1. Three options give a card with ids A, B, C and `allowOther: true`.
  2. A second call in one turn is refused, and no second card is emitted.
  3. A bound `workspace.describe` with `{description: 'short'}` (fails `min(10)`) is refused, naming option A and the field.
  4. A bound unknown action id is refused.
  5. A bound valid `source.connect` input passes, and its `action` is on the emitted option.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(chat): ask_choice asks one question per turn as a choice card`

---

### Task 3: An answer is a user turn; a bound option runs as the person

**Files:**
- Create: `src/services/chat/answerChoice.ts`
- Modify: `src/app/[locale]/rpc/agent/stream/route.ts`:
  - read `body.card_answer` next to `body.message` (:57)
  - call `answerChoice` before the user `appendMessage` (:223)
  - put its `modelPrefix` into `messageForModel` (:239)
  - pass the user row's `runs`
- Modify: `src/routers/Conversations.ts:210` (`recordCardDecision` gains `action: 'dismiss'`)
- Modify: `src/services/chat/historyTools.ts` (a choice-card branch, so the model never reads a choice card as "waiting on approval, decide_proposal N")
- Test: `src/services/chat/answerChoice.test.ts`, `src/services/chat/historyTools.test.ts` (extend)

**Interfaces:**

<!-- eslint-skip -->
```ts
export type ChoiceAnswer = { cardId: string; optionId: 'A' | 'B' | 'C' | 'D' | 'other'; text?: string /* required for 'other' */ };
export type AnsweredChoice =
  | { ok: true; question: string; answerText: string; modelPrefix: string; userRuns: ConversationRun[]; actionOutcome: string | null }
  | { ok: false; status: 404 | 409 | 400; error: string };
/**
 * Mark a choice card answered and run its bound actions as the person, in order (#1028).
 * The card and its binding are read from the persisted run, never from the request.
 * - unknown card in this conversation → 404; already answered or skipped → 409;
 *   an option the card doesn't have, or 'other' when allowOther is false or text is empty → 400.
 * - `markCardRun(... expectState: 'proposed', patch: {state:'decided', answer})` decides the race:
 *   the loser gets 409 and runs nothing.
 * - Each bound action is proposed and approved as the person through the same path a card button
 *   uses (`ActionService.proposeAction`, then `ReviewService.decide` with `reviewedBy: userId`).
 *   Read `src/routers/Review.ts:168` and `:415` and call the services, not the routes.
 *   One failing action does not stop the rest. Each outcome, or failure message, is one line of `actionOutcome`. A failed action never un-answers the card.
 * - modelPrefix: `Answered "<question>": <answerText>` plus, for each action that ran, `\n(<actionId> ran: <outcome>)`
 *   or `\n(<actionId> failed: <message>)`.
 * - userRuns: `[{ type: 'card_decision', cardId, action: 'answer', label: question, option: optionId }]`.
 */
export async function answerChoice(input: { orgId: string; userId: string; conversationId: number; answer: ChoiceAnswer }): Promise<AnsweredChoice>;
```

- Route: when `card_answer` is present and `answerChoice` returns `ok: false`, respond with that status and a JSON error. Do it **before** any SSE stream or agent run starts.
  - The user row's `content` is `answerText`, which is what the person sees as their message.
  - `messageForModel` starts with `modelPrefix`, which is also what the scripted model matches on.
- `recordCardDecision`, `action: 'dismiss'`:
  - Content `Skipped the question "<label>".`
  - `markCardRun(... expectState: 'proposed', patch: {state: 'deferred'})`
  - No agent turn (unchanged).
- `historyTools` choice branch. The synthetic tool result for a choice card reads:
  - `Question "<q>" (card <id>) was answered: <answer>.`, or
  - `… was skipped by the person.`, or
  - `… is still open on the person's screen; don't ask it again.`

- [ ] **Step 1: Write the failing tests** (PGlite, with a conversation and a choice card run seeded). Each is a rule:
  1. **Answer A** (no binding). Returns `answerText` = A's label. The run reads `state: 'decided'` and `answer.optionId: 'A'`.
  2. **Answer `other`.** With text, it works. With empty text, it's a 400. With `allowOther: false`, it's a 400.
  3. **A card id from another conversation** returns 404.
  4. **An option id `D` on a three-option card** returns 400.
  5. **The race.** Two concurrent `answerChoice` calls (`Promise.all`) give exactly one `ok: true` and one 409, and the bound action executed once. Count `action_run` rows, or stub the action's execute with a counter on a test-registered action.
  6. **The binding comes from the persisted run.** The `ChoiceAnswer` type has no action field, so the test asserts the action that ran is the persisted one.
  7. **A bound action whose execute throws.** The card is still answered, `ok: true`, and `modelPrefix` contains `failed:` and the message.
  7b. **Two bound actions, the first throws.** The second still runs, and `modelPrefix` has one `failed:` line and one `ran:` line, in order.
  8. **History.** An answered choice card replays as `was answered: <label>`, never `decide_proposal`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** `answerChoice`, the route wiring, `dismiss` and the history branch.
- [ ] **Step 4: Run them.** Expected: PASS. Then run `npx vitest run src/app/\[locale\]/rpc/agent src/routers/Conversations src/services/chat`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(chat): a choice answer is the person's turn; a bound option runs as them`

---

### Task 4: The choice card on screen

**Files:**
- Create: `src/features/dashboard/chat/cards/ChoiceCard.tsx`
- Modify: `src/features/dashboard/chat/RecommendedActionStack.tsx` (render `ChoiceCard` when `rec.kind === 'choice'`)
- Modify: `src/features/dashboard/chat/useChatSession.ts` (the send path at ~:1337–1431 takes an optional `cardAnswer` and posts it as `card_answer`; an optimistic local `answer` on the card; on a 409, refetch the conversation)
- Modify: `src/features/dashboard/chat/cards/CardDecisions.tsx` (a sibling context, `CardAnswerProvider`, provided where `CardDecisionProvider` is: `ChatShell.tsx:413`, `ChatDock.tsx:742`)
- Test: `src/features/dashboard/chat/cards/ChoiceCard.test.tsx`

**Interfaces:**
- `ChoiceCard({ rec, onAnswer, onDismiss })`:
  - **Proposed:** the question as the title, the hint under it, one button per option showing the letter and label (and the description when present), and, when `allowOther`, a `Type your own answer` text field with a send button. A dismiss control labelled `Skip`.
  - **Answered:** collapses to the question plus `✓ <answer text>`, with no controls.
  - **Skipped:** collapses to the question plus `Skipped`.
- `onAnswer({cardId, optionId, text})` sends a chat message whose text is the option label (or the typed text), with `card_answer`. `onDismiss({cardId, label})` calls `recordCardDecision` with `action: 'dismiss'`.
- A send in flight disables every option. That is the client half of the double-tap guard; the server half is Task 3.

- [ ] **Step 1: Write the failing RTL tests.**
  1. Three options render as `A`, `B`, `C` buttons with their labels. Clicking B calls `onAnswer` with `optionId: 'B'` and B's label.
  2. Typing `Ship the portal` and sending calls `onAnswer` with `optionId: 'other'` and that text. Send is disabled while the field is empty.
  3. An answered card shows `✓ Coding & GitHub` and no buttons.
  4. `Skip` calls `onDismiss`, and a skipped card shows `Skipped`.
  5. After one click, the options are disabled until the card's state changes.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the styling of `RecommendedActionCard.tsx`: same tokens, same card frame.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(chat): the choice card: lettered options, your own answer, skip; collapses once answered`

---

### Task 5: The interview procedure

**Files:**
- Modify: `src/services/agents/tools/workspaceSetup.ts` (`STEP_GUIDE`, plus a standing `HOW_TO_ASK` line printed on every status)
- Modify: `src/routers/Onboarding.ts` (`start`: the opening message carries the opener choice card as a run) and `src/services/OnboardingService.ts` (an `openerCard` builder, and opening text that no longer asks the question in prose)
- Modify: `templates/plugins/software-factory/plugin.yaml`:
  - `recommend.connectors: [github, jira, slack]`
  - version `2.57.0`
  - a changelog entry dated 2026-10-02
- Modify: `src/libs/workspace/plugins.test.ts` (expects `+software-factory@2.57.0`)
- Test: `src/services/agents/tools/workspaceSetup.test.ts` (extend), `src/services/OnboardingService.test.ts` (extend)

**Interfaces:**
- `openerCard(input: { plugins: Array<{ slug: string; name: string; when: string[] }>; enabled: string[] }): Card`:
  - kind `choice`, title `What do you want me taking off your plate?`
  - options: up to 3 plugins. Enabled plugins come first, then catalog plugins with a non-empty `recommend.when`, each group in catalog order. `label` = plugin `name`, `description` = its first `when` entry, cut at 200 characters on a word boundary.
  - `allowOther: true`, no bound actions
  - hint: `Pick one, or type your own. I'll ask one thing at a time.`
- `HOW_TO_ASK`, verbatim: `Ask every setup question with ask_choice: one per turn, options built from what you know, broad first and narrower with each answer. After a connector connects, call browse_connection and turn what it returns into the next ask_choice; bind source.connect to the options so the pick saves the source. When something doesn't line up — a missing status, a noisy list, a failed login — say what you found in one sentence and offer the ways forward as the options. Never ask for a password or token in chat: offer the connection instead.`
- The `STEP_GUIDE` steps (describe, connect, grow) stay. Their wording moves from prose questions to `ask_choice`:
  - **describe:** after the opener's answer, ask narrower questions with `ask_choice`. When you can say what the workspace is for in a sentence, offer it as option A bound to `workspace.describe` with that sentence, and option B `Let me say it differently`.
  - **connect:** for each connector the chosen plugin's `recommend.connectors` lists that isn't connected, `offer_connection`, one at a time, most useful first. You may offer any other connector the conversation points to.
  - **grow:** for a software workspace, ask in this order (amended 2026-10-02 from the recorded test in #1028, "The software path, start to first shipped change"):
    1. which repos (from `browse_connection` repos, bound `source.connect`)
    2. suggest products from those repos (Task 6)
    3. which tracker project holds the roadmap (from projects, bound `source.connect` with `baseUrl`, `projectKeys` and the `sourceSlug` the earlier result named, when there is one)
    4. what is in that project, and the cleanup sweep (Task 9)
    5. how to work the roadmap: which statuses, in what order, how many a day (Task 7)
    6. what the factory may do on its own (Task 7). A hands-off answer is saved as the goal (Task 11), never as a raised rung.
    7. where the app runs and how QA signs in (Task 10)
    8. what to do first. Options A–C are the highest-ranked open tickets in the intake statuses, never ones in progress, in QA or done. A typed answer is a new request: file it with `file_request` the way `intake-from-chat` does, say so in one sentence, and start on it in the same conversation. Never ask the question again.

- [ ] **Step 1: Write the failing tests.**
  1. `openerCard` puts an enabled plugin first, caps at 3 options, and uses each plugin's first `when` entry as the description.
  2. `onboarding.start` appends an opening message whose `runs` hold one `choice` card titled exactly `What do you want me taking off your plate?`.
  3. Every `renderSetupStatus` output contains `HOW_TO_ASK` verbatim.
  4. The `connect` step names `recommend.connectors`.
  5. software-factory's manifest has `recommend.connectors` equal to `['github', 'jira', 'slack']`, read through `loadPlugin`.
  6. The `grow` step lists its eight questions in the order above, and its "what to do first" line says a typed answer is filed with `file_request` and is not asked again.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS. Then run `npx vitest run src/libs/workspace src/services/OnboardingService src/routers/Onboarding`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(onboarding): setup is an interview: one choice card at a time, real data after each connect`

---

### Task 6: Product suggestions create everything in one tap

**Files:**
- Create: `src/libs/actions/objects-create-group.ts`, registered in `src/libs/actions/registry.ts`
- Modify: `templates/plugins/software-factory/skills/products-from-repos/SKILL.md` (the procedure now uses `browse_connection`, then one `ask_choice` per product with option A bound to `objects.create_group`; it no longer uses `file_product`)
- Modify: software-factory `plugin.yaml` changelog, under the 2.57.0 entry from Task 5
- Test: `src/libs/actions/objects-create-group.test.ts`

**Interfaces:**

<!-- eslint-skip -->
```ts
export const objectsCreateGroupInput = z.object({
  /** The record the group is about, e.g. a product. */
  parent: z.object({ type: z.string().min(1), title: z.string().min(1), fields: z.record(z.string(), z.unknown()) }),
  /** Records that point at the parent, e.g. its repos. */
  children: z.array(z.object({ type: z.string().min(1), title: z.string().min(1), fields: z.record(z.string(), z.unknown()) })).max(50),
  /** The child field that holds the parent's link value, and which parent field supplies it (e.g. 'product' ← 'slug'). */
  link: z.object({ childField: z.string().min(1), parentField: z.string().min(1) }),
});
/** id 'objects.create_group', external false. */
export const objectsCreateGroupAction: Action<typeof objectsCreateGroupInput>;
```

- `execute`, in ONE `db.transaction`:
  1. Resolve both types for the org.
  2. Dedup the parent by its type's `x-agent-file.dedupOn` (read how `objects-propose-candidate.ts` reads `dedupOn` and `candidateDedupKey` at :338, and reuse them). When the parent exists, use it.
  3. Insert the missing children with `fields[childField] = parent.fields[parentField]`, deduped the same way.
  4. Return `{ parent: {id, created}, children: [{id, title, created}] }`.
  - Any failure rolls the whole group back.
  - Records are created `active`, because the person approved them by picking the option.
- `precheck`: both types exist for the org and `link.parentField` is in the parent's fields. Otherwise a sentence naming what's missing.
- `undo`: delete what this run created, and nothing that already existed.
- **Rejection** is option B, `Not now`, with no binding. Task 3's `card_decision` run already records who answered which card and when. Nothing marks the suggestion refused, so it can be suggested again.
- SKILL.md wording rules:
  - it says it drafts by asking, and the person's pick creates the records
  - it never says it creates anything itself
  - it checks `lookup_objects` first, so existing products and repos aren't suggested
  - when a product would own repos that already have a product, it says so on the card
  - (amended 2026-10-02) it never suggests work, features or gaps that the connected tracker already has in progress, in QA or done: it searches the tracker with `tracker_search_issues` first. The recorded test's gap analysis proposed tickets that were already shipped.

- [ ] **Step 1: Write the failing tests** (PGlite, with the software-factory `product` and `repo` types seeded the way `objects-propose-candidate` tests seed types; grep for one):
  1. A product with two repos creates three records, each repo's `product` field equal to the product's slug, in one go.
  2. **Approving twice.** Running the same input again creates nothing and reports `created: false` for every record.
  3. **An existing product.** It isn't duplicated. Only its missing repos are created.
  4. **All or nothing.** A child whose type doesn't exist fails the precheck. If a child insert fails mid-way (force it with a spy), no record remains.
  5. **Core names no type.** `grep -n "'product'\|'repo'"` over `objects-create-group.ts` finds nothing. Put this in the test as a source-text assertion, which guards the spec's plugin-boundary rule.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the action and the skill rewrite.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(factory): a suggested product and its repos are created in one tap, or not at all`

---

### Task 7: The factory's working rules land where it reads them

**Files:**
- Modify: `src/libs/sources/jira.ts` (`jiraConfigSchema`: optional `intakeStatuses: z.array(z.string().min(1)).max(10).optional()`) and `src/libs/sources/configFields.ts` (a matching field, `Statuses the factory picks up`)
- Create: `templates/plugins/software-factory/automations/factory-tracker-intake.yaml` (copy the shape of `factory-daily-plan.yaml`; schedule hourly on weekdays; the PM files a request for each issue in a configured intake status not already filed, with the dedup rules in `skills/intake-from-the-tracker/SKILL.md`)
- Create: `src/libs/actions/autonomy-lower.ts` (`autonomy.lower`: calls `AutonomyService.demote` for the listed action ids; never promotes), registered in the registry
- Modify: software-factory `plugin.yaml` changelog (2.57.0)
- Test: `src/libs/actions/autonomy-lower.test.ts`, `src/libs/sources/jira.config.test.ts` (extend or create), `src/libs/workspace/plugins.test.ts` (the automation loads)

**Interfaces:**
- **Roadmap question (amended 2026-10-02: order and pace, from the recorded test).** `How should I work the roadmap?` Asked in the `grow` step, built from `browse_connection` statuses for the chosen project.
  - Options:
    - `One a day, highest priority first` (bound `source.connect` with the Jira config, `sourceSlug`, `intakeStatuses: [<status>]`, `intakePerDay: 1`)
    - `Everything in <status> now, highest priority first` (same binding, no `intakePerDay`)
    - `Only tickets I point you at` (no binding, today's behaviour)
  - When no status is named like the person's word (for example "Ready"), the card says so and offers the closest statuses.
  - `jiraConfigSchema` gains `intakePerDay: z.number().int().min(1).max(20).optional()` beside `intakeStatuses`, with a `configFields` entry, `How many a day the factory picks up`. Both fields use the `replace` pick policy (ledger ruling), so a later answer replaces the earlier one.
  - The automation files at most `intakePerDay` requests from the tracker per calendar day, in the workspace's time zone, highest tracker priority first. It counts what it already filed that day by the tracker URL in `evidence.urls`. Its summary names the date it counted for.
- **Autonomy question (amended 2026-10-02).** `What may I do on my own?`
  - Options:
    - `Ask me before every build and merge` (no binding, today's trust ladder)
    - `Ship on green once I've earned it` (bound `autonomy.set_goal`, Task 11, with `{actionIds: ['git.merge'], goal: 'execute-within-bounds'}`. The rung does not move.)
    - `Ask me even before merging pipeline fixes` (bound `autonomy.lower` with `{actionIds: ['git.merge.pipeline'], to: 'execute-with-approval'}`)
  - The hint, verbatim: `The factory starts by asking. It earns building and merging on its own as its work lands clean, and you can see that on the Autonomy page.`
  - **No option raises autonomy.** The recorded test's "ship it and tell me when it's done" becomes a goal the factory earns its way to.
- `autonomy.lower` input: `{ actionIds: z.array(z.string().min(1)).min(1).max(10), to: z.enum(RUNGS) }` (`RUNGS` from `src/services/autonomy/rungs.ts`). Amended 2026-10-02 by ledger ruling: a target rung, not one step per call, so a retry never lowers twice.
  - Execute, in one transaction: for each id, a rung at or below `to` is left as it is and reported; a rung above `to` is demoted with `demote(orgId, actionId, by, 'chosen during setup')` until it reaches `to`. `AT_BOTTOM` never reaches the person.
  - Returns `{ lowered: [{actionId, from, to}] }`.
  - Undo is refused with `Raising autonomy is earned; promote it from the Autonomy page when its evidence supports it.`

- [ ] **Step 1: Write the failing tests.**
  1. `jiraConfigSchema` accepts `intakeStatuses: ['To Do']` and rejects `intakeStatuses: ['']`.
  2. `autonomy.lower` on `git.merge.pipeline` with `to: 'execute-with-approval'` lands on that rung, as read back through `effectivePolicy`. Running it again changes nothing and reports the same rung.
  2b. `jiraConfigSchema` accepts `intakePerDay: 1` and rejects `0` and `21`.
  3. `autonomy.lower` never raises: the action module never imports `promote`.
  4. Undo is refused with the sentence above.
  5. software-factory loads with the new automation, and its schedule parses.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Before writing the automation**, read `factory-daily-plan.yaml`, the automation schema in `src/libs/workspace/schemas.ts`, and `intake-from-the-tracker/SKILL.md`.
  - The automation's prompt names the source config key `intakeStatuses`.
  - It reads issues with `tracker_search_issues` (`status in (...)`, which is already bounded to the source's projects).
  - It files through `file_request` with the tracker's issue URL first in `evidence.urls`, which the skill uses for dedup.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(factory): setup saves how work enters the factory and lowers, never raises, its trust`

---

### Task 8: E2E: the software path, end to end

**Files:**
- Create: `e2e/interview/interview.spec.ts`, `e2e/interview/scripts/interview.json` (scripted model), `e2e/interview/scripts/connect.json` (scripted providers: GitHub and Atlassian ok, with browse fixtures for repos, sites, projects and statuses), and `e2e/interview/support/seed.ts` (copy the onboarding seed, with software-factory enabled)
- Modify: `playwright.config.ts`, `package.json` (an `e2e:interview` script), and the CI e2e matrix if projects are listed there

**Interfaces:**
- The scripted model matches on the person's line. A choice answer's model message starts `Answered "<question>": <label>`, so each script turn matches a distinctive label. Turns:
  1. **`coding & github`** (the opener answered B). `ask_choice` for "What should the factory build?". `workspace_setup` first.
  2. **`the customer portal`.** `ask_choice`, option A bound to `workspace.describe` (`Northwind engineering ships the customer portal.`).
  3. **`northwind engineering ships`.** `offer_connection` for GitHub.
  4. **`i connected github`** (the return pre-fill). `browse_connection` for repos, then `ask_choice` with A `northwind/portal`, bound `source.connect {connector:'github', config:{repos:['northwind/portal']}}`.
  5. **`northwind/portal`.** `offer_connection` for Jira.
  6. **`i connected jira`.** `browse_connection` for projects, then `ask_choice`, A `Portal (PORT)`, bound `source.connect` with the site `baseUrl` from the fixture and `projectKeys: ['PORT']`.
  7. **`portal (port)`.** `browse_connection` for statuses on PORT. The fixture has no "Ready", so `ask_choice` with:
     - A `Only tickets I point you at`
     - B `Pick up tickets in To Do`, bound `source.connect` with `intakeStatuses: ['To Do']`
     - the hint `PORT has no status named Ready; the closest is To Do.`
  8. **`pick up tickets in to do`.** The PR question from Task 7.
  9. **`ask me before every build`.** The reply `Set up. …`.
- **Amended 2026-10-02 (Jamie's recorded test, #1028).** After turn 7, the script walks the new steps, each turn on a distinct substring (ledger ruling):
  - the sweep (Task 9): the fixture has two stale tickets; answer `Leave the board as it is` and assert no tracker write was recorded
  - the roadmap question: answer `One a day, highest priority first`; assert the Jira source has `intakePerDay: 1`
  - the autonomy question: answer `Ship on green once I've earned it`; assert `git.merge`'s rung is unchanged and its goal reads `execute-within-bounds`
  - access (Task 10): the app-login connect card (stubbed paste), then a typed URL, then the confirm card; assert an `environment` record with that URL and a QA sign-in
  - what to do first: a typed answer, `sort the users page by first name`; assert one request filed with that text
- Assertions, through the app's own API. PGlite takes one connection, so never read the DB directly:
  - each card collapses to its answer
  - the Connectors list shows the GitHub source with `northwind/portal` and the Jira source with `PORT` and `intakeStatuses: ['To Do']`
  - `/dashboard/developers` lists two login rows
  - a reload of the conversation shows every answered card collapsed
  - no request went to a real vendor host (the request recorder from the connect plan's Task 14)

- [ ] **Step 1: Write the scripts and the spec.**
- [ ] **Step 2: Run it** with the local recipe from the connect plan's Task 14, with `VOCION_LLM_PROVIDER=scripted`, `VOCION_LLM_SCRIPT=e2e/interview/scripts/interview.json` and `VOCION_CONNECT_SCRIPT=e2e/interview/scripts/connect.json`. Expected: 1 passed.
- [ ] **Step 3: Run `onboarding`, `chat-incomplete` and `connect` again.** Expected: all pass. The opener is now a card, so update `onboarding.spec.ts` where it relied on the prose question. That is a real behaviour change.
- [ ] **Step 4: Commit.** `test(onboarding): e2e: the software setup interview, providers and model scripted`

---

### Task 9: A look at the tracker, and a cleanup sweep

Added 2026-10-02 from Jamie's recorded test (#1028, "Show what is in the tracker, then offer a cleanup sweep").

**Files:**
- Create: `templates/plugins/software-factory/skills/sweep-the-tracker/SKILL.md`, mounted on the PM seat beside `intake-from-the-tracker`
- Modify: software-factory `plugin.yaml` changelog
- Test: `src/libs/workspace/plugins.test.ts` (the skill loads and the PM mounts it)

**Interfaces:**
- Read in the `grow` step, right after the tracker project is chosen. The procedure:
  1. Read the project with `tracker_search_issues` (bounded to the source's projects) and say in one message what is there: open tickets by status, and the date of the oldest open one.
  2. Find up to three groups: **stale** (open, not updated in 60 days, dated against today with today's date stated), **already shipped** (open, but a linked pull request merged), and **duplicates** (open, same title once case and punctuation are ignored; keep the oldest).
  3. One `ask_choice`: an option per non-empty group, plus `Leave the board as it is`. No option is bound: a tracker change is external, and a choice option may bind only changes inside Vocion (ledger ruling, Task 3). When a group is picked, propose one `tracker.transition_issue` per ticket in it (at most 20; say how many more remain) through the normal proposal path, so the person approves each exact change.
  4. When every group is empty, say the board is tidy in one sentence and ask nothing.
- Wording rules: it drafts by asking. The pick says which change set to draft, and each change still waits for the person's approval. It never moves a ticket on its own. It never offers a ticket that is in QA or done.

- [ ] **Step 1: Write the failing test.** software-factory loads, `sweep-the-tracker` is in its skills, and the PM seat mounts it.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Write the skill and the changelog line.**
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(factory): setup shows what is on the board and offers a cleanup, one pick per change set`

---

### Task 10: Where the app runs, and how QA signs in

Added 2026-10-02 from Jamie's recorded test (#1028, "Prove the first change on the running app").

**Files:**
- Modify: `src/services/agents/tools/workspaceSetup.ts` (`STEP_GUIDE` grow step 7 wording)
- Modify: `templates/plugins/software-factory/skills/products-from-repos/SKILL.md` or a new `skills/record-the-environments/SKILL.md`, whichever keeps one skill per job; read both first
- Test: `src/services/agents/tools/workspaceSetup.test.ts` (extend), `src/libs/workspace/plugins.test.ts` when a skill is added

**Interfaces:**
- Grow step 7, in order:
  1. `offer_connection` for `app-login`, so the QA sign-in is pasted on the Connectors page and never typed in chat.
  2. `ask_choice`: `Where does <product> run for testing?`. Options come from what is known (repo homepages, deployment URLs the code host returns), plus `Type your own`.
  3. A confirm card: A `Save <url> as <product>'s <stage> environment`, bound to `objects.create_group` (Task 6) with the existing product as the parent and one `environment` child carrying `stage`, `url` and `qaLoginCredentialId` (the newest live app-login credential), linked `product` ← `slug`. B `That's not right`.
- Before writing, read `src/services/factory/productAccess.ts` and confirm it reads the QA sign-in from `environment.qaLoginCredentialId`. If it reads it from somewhere else, bind that instead and say so in the report.
- Core still never names `environment`, `product` or `repo`: the type slugs live in the skill and the step guide's plugin text, not in core code.

- [ ] **Step 1: Write the failing tests.** The grow step's line 7 names `app-login` before the URL question, and says the password is never typed in chat. When a skill is added, it loads.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(onboarding): setup records where the app runs and how QA signs in, so the first change comes back with a picture`

---

### Task 11: A hands-off answer is saved as a goal, never as a rung

Added 2026-10-02 from Jamie's recorded test (#1028, "Ask what the factory may do").

**Files:**
- Create: `migrations/0167_autonomy_goal.sql` (renumber at the rebase if main has taken 0167): `ALTER TABLE "autonomy_policy" ADD COLUMN IF NOT EXISTS "goal_rung" text;`, then `"goal_set_by" text` and `"goal_set_at" timestamp`, each `IF NOT EXISTS`, with `--> statement-breakpoint` between them and a journal entry
- Modify: `src/models/Schema.ts` (`autonomyPolicySchema`: `goalRung`, `goalSetBy`, `goalSetAt`)
- Create: `src/libs/actions/autonomy-set-goal.ts`, registered in the registry
- Modify: the Autonomy page (grep the route that renders `effectivePolicy` rungs) to show the goal beside the rung
- Test: `src/libs/actions/autonomy-set-goal.test.ts`, the Autonomy page's test (extend)

**Interfaces:**
- `autonomy.set_goal` input: `{ actionIds: z.array(z.string().min(1)).min(1).max(10), goal: z.enum(RUNGS) }`. Grant `manage_workspace`, external false.
  - Execute: for each id, upsert the policy row, keeping its current `rung` (the default rung when the row is new), and set `goalRung`, `goalSetBy` (the person who picked) and `goalSetAt`. It never changes `rung` and never imports `promote`.
  - Undo clears the goal and leaves the rung alone.
- The Autonomy page shows, under the rung: `Goal: <rung label>, set by <name> on <date>`. When the page already shows what evidence the next rung needs, the goal line sits beside it.

- [ ] **Step 1: Write the failing tests.**
  1. `autonomy.set_goal` on `git.merge` with `execute-within-bounds` leaves the rung read through `effectivePolicy` unchanged, and stores the goal with who and when.
  2. The action module never imports `promote` (a source-text assertion).
  3. Undo clears the goal, and the rung is still unchanged.
  4. The Autonomy page renders `Goal: …, set by … on <date>` for a row with a goal, and nothing for a row without one.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `npm run check:migrations`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(autonomy): a person can name the rung the factory is working toward; reaching it is still earned`

---

## After the last task

- Run the gates from `packages/core` and paste the results into the ledger: `npm run check:types`, `npx vitest run`, `npm run check:migrations`, and lint on changed files. Then run `npm run check:deps` from the repo root.
- Run e2e for `onboarding`, `chat-incomplete`, `connect`, `interview`, and `documents` on real Postgres.
- Read the whole diff for client names, nested functions, dead exports and debug prints.
- Update #1028 with what shipped, the rulings, and the QA steps. Open the PR against `feat/issue-1028-workspace-onboarding` (or `main`, if #1069 has merged by then).
