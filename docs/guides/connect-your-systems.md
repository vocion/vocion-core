# Connect your systems

"Connect your systems" walks a person through connecting the tools their work
lives in, one at a time, in a decision card docked above the chat composer. It
ranks what to connect from evidence, asks at most one question, connects each
system by login or by a key typed inline, checks each one before moving on,
and ends with what each connected system unlocks.

It never leaves the conversation (principle 5). Every step shows why it is
offered (principle 10). Nothing in it names a vendor: the list, how each
system connects and the mail evidence all come from the platform and connector
registries, so a connector added there is offered here with no change
(principle 7).

## Ways in

Every way in is a turn first (founder, 2026-10-09): a link into chat with
`?objective=connect-systems` (`libs/connect/systemsLink.ts`) sends the person's
own words ("Help me connect the systems GTM uses", `connectSystemsAsk`), and
the lead's `connect_system` raises the walk-through — with its own title and
why, composed from the facts the tool hands back.

| Where | What starts it |
|---|---|
| Chat | "connect my tools", "what should I connect?", or two or more systems named at once. The agent calls `connect_system`; it reaches the person as one setup Decision ("Connect your systems") whose option opens the walk-through, and arriving live it opens it at once. The workspace's lead's `workspace-setup` skill says when. |
| Onboarding | The **Getting started** checklist's "Connect a system" step. A setup plan (`propose_setup`) with two or more `connect` steps also becomes one "Connect your systems" step. |
| An app's page | "Connect the 3 systems GTM uses", above the app's "Connects to" list. Planned for that app only (`&app=<id>`). |

## What it offers, and why

`recommendConnections` (`services/connect/recommendations.ts`) ranks every
connector that a credential platform claims and that this workspace does not
already read with a live login or key. Each piece of evidence is typed, scored
and shown under the step it put there.

| Evidence | Where it comes from | Weight |
|---|---|---|
| You named it | Connector slugs the agent read from the person's words. Nothing in code matches words. | 100 |
| An app needs it | An app this workspace added declares it in `setup.connectors` (or in `recommend.connectors`, "reads it", 25) | 60 |
| Your mail is hosted there | The person's address's MX records match a platform's `discovery.mailHosts` in `libs/platforms/registry.ts`. That platform's `discovery.connectors` are offered. | 40 |
| Your Org uses it | Other **shared** workspaces of the same Org read it: 15, plus 5 for each further workspace. | 15+ |

A system scoring 35 or more is *recommended*: it is preselected and offered
first.

**Tenant scoping.** Every read is keyed on the one workspace. The Org evidence
reads only the workspace's own Org (`project.account_id`) and only its shared
workspaces, never a person's own. It reads only connector slugs and a count,
never a source's name, account or settings. `recommendations.test.ts` holds
this against a second Org and a personal workspace.

**Mail evidence** is bounded. A lookup that fails or takes longer than 1.5s
means there is no evidence, never an error. Reserved fixture domains
(`.example`, `.test`) are never looked up. A new mail platform (Microsoft 365,
say) is recommended by adding its hosts as `discovery` on its descriptor.

## The one question

When the person named nothing and no app scoped the plan, the walk-through
opens on one multi-select decision: **"Which of these do you use?"** The ranked
list is offered with the recommended systems preselected. Enter takes the
preselected set. Number keys toggle. Skip ends the walk-through. "Something
else" sends the person's own words to the agent as their next message, so a
system named that way is read by the model and never matched.

## One system at a time

Each system is one docked decision. The eyebrow carries the progress line,
**"Connect your systems · 2 of 5"**, and Stop (Esc) sits on the right.

1. **Connect** (recommended, preselected): the way this connector connects, from its descriptor.
   - **Login.** The provider's login opens in a small window: the ordinary
     start route, the vendor, then the callback. The window lands on
     `/dashboard/connect/done`, which posts the outcome back and closes. If the
     login names settings the source still needs (`settingsAfterLogin`), they
     are asked inline next.
   - **Key.** The credential's fields (from the platform registry) and the
     source's required settings (from `configFields.ts`) are typed into the
     card. `connectSystems.saveKey` writes them straight to the vault, in the
     Connectors page's one transaction (`createSourceWithCredential`). The
     value is cleared from the page once it is saved, and never shown again.
   - **Its full form.** For a connector whose settings cannot be asked inline,
     the Connectors page's form opens in the window.
2. **Later** puts the system off. The summary offers "Connect the ones I put off".
3. **Skip** (the footer button) moves on.

A blocked pop-up, a declined login or a failed check stays on the system with
its reason and **Try again** first.

## Verified before moving on

`connectSystems.verify` (`services/connect/verifyConnection.ts`) runs two checks:

- **The test call.** The connector's own `inspect`, run against the stored
  credential, when it declares one.
- **The first-sync preview.** What the new source's first sync has stored,
  counted in the noun the connector declares (`recordNoun`), for example
  "Found 1,284 deals". It is counted in documents otherwise.

The flow polls for about 12 seconds. A sync still reading after that moves on
with the count so far, and the sync finishes in the background. Every system
that connects fires `vocion:workspace-setup-changed`, so the checklist and an
app page's connector status re-read.

## The summary

The summary lists each system with its preview and what it unlocks: the apps
that read it and the features that name it. Systems put off or skipped are
listed as such. **Done** answers the Decision that started the walk
(`connectSystems.finish` → `services/connect/settleWalk.ts`): typed, on the
person's side ("Chose Start: Connected Northwind CRM, Tracker · later: Wiki. ·
Connect your systems"), written as a `decision` row with what happened. No turn
runs then; a reload, and the agent's next turn, read it from there. Stopped
before Done, the Decision stays docked — Start opens the walk again.

## Pieces

| | |
|---|---|
| Plan types | `libs/connect/systemsPlan.ts` |
| The link | `libs/connect/systemsLink.ts` |
| Ranking | `services/connect/recommendations.ts` |
| Mail evidence | `libs/connect/mailHost.ts`, `CredentialPlatform.discovery` |
| Verification | `services/connect/verifyConnection.ts`, `SourceConnector.recordNoun` |
| RPC | `routers/ConnectSystems.ts` (`connectSystems.plan`, `saveKey`, `verify`, `finish`) |
| Chat tool | `services/agents/tools/connectSystems.ts` (`connect_system`), card kind `connect-systems`, which the escalation rule turns into a setup Decision (`services/decisions/escalate.ts`) |
| UI | `features/dashboard/connect-systems/`: the state machine (`flow.ts`), each step drawn by the one Decision card (`DockedDecision.tsx` maps a step onto `chat/decisions/DecisionCard.tsx`), the view, the flow, the login window. While the walk runs it is the docked card (`ConversationDecisions`) |

The walk-through is self-contained and typed. Its state says where it is
(`progressOf`) and what became of each system, so it can be wrapped as one
objective in the Decision model. Every step is the Decision card itself, so
it keeps that card's keyboard contract:

- 1 to 9 picks an option.
- The arrow keys, Home and End move through the options.
- Space picks the highlighted option.
- Enter or ⌘↵ submits.
- Tab reaches "Something else".
- Esc stops the walk, or goes back from a form.

## Testing it

- **Unit tests:**
  - `recommendations.test.ts`: ranking from each kind of evidence, tenant scoping, the one question, app scope, not an admin.
  - `verifyConnection.test.ts`.
  - `ConnectSystems.test.ts`: a key is never logged or echoed, whatever the save throws; every call is scoped to the session.
  - `connectSystems.test.ts` (the tool).
  - `flow.test.ts`.
  - `mailHost.test.ts`.
  - `systemsLink.test.ts`.
- **UI:** `ConnectSystemsFlow.test.tsx` drives the whole walk from the keyboard.
- **Storybook:** `Chat/ConnectYourSystems`.
- **End to end:** `npm run e2e:connect-systems`. It covers the Connectors page
  entry, a scripted login in its own window and a scripted API-key connector,
  each verified with a scripted first sync (`verify` in the connect script), the
  summary answering the Decision, and the chat path through `connect_system`
  on the scripted model.

## Related

[Connecting a tool](./connect.md) · [Getting started in a new workspace](./getting-started-in-a-workspace.md) · [Agent tools](./agent-tools.md)
