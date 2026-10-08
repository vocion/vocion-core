# Red team

A second reader, from another model family, on every word an agent is about
to publish under the company's name.

## What turning it on gives you

Before an agent's proposal of an action that publishes outside the workspace
runs or reaches anyone, a **critic** reads what it would publish and returns
**typed findings**: each a severity (`serious` / `minor`), the rule it breaks
(`voice` / `fact` / `claim` / `other`), the words quoted, why, and the fix.
Core routes on those fields — never on the critic's prose:

| What it found | An agent's proposal | Your own word |
|---|---|---|
| Nothing serious | Goes on to the trust ladder as it would have; minor findings ride on the run | Runs |
| Serious, first draft | **Sent back** to the agent that wrote it, with the findings, to revise once. Nothing is queued; the return is on the ledger | Runs — the findings come back to you as one line of advice |
| Serious, after a revision | **A person decides**, whatever the trust ladder says, with the findings on the card | Runs, with the advice |
| The critic could not read it | A person decides, and the card says why | Runs |

A check informs and never stops a person (CLAUDE.md, *Accelerate, never
block*): what you tell an agent to send goes out as your action.

## Why a different vendor

One model drafting and the same family checking share the same blind spots —
the confident wrong number, the claim nothing backs, the register you banned.
So the critic is always a model from a **different vendor than the author**:
an agent writing on Claude (Anthropic directly or on Bedrock) is read by an
OpenAI model, an agent on OpenAI by a Claude model. The author's vendor is read
off its agent's `harness`; the critic is the first other vendor the workspace
can reach — its own key on Connections first, the server's second
(`buildChatModelForOrg`). The call is charged to the workspace's budget like
any other model call, under `gate.action`, against the agent whose draft it
read.

No second vendor reachable? The gate does not pretend: an agent's proposal
goes to a person with "no model from a vendor other than … is reachable" on
the card. Connect a second vendor's key on **Connections** to let it read.

## What it reads against

- **Voice** — the workspace's `voice.yaml` over the platform floor
  ([voice rules](../../../../../docs/guides/voice-rules.md)). Checked twice:
  deterministically by the rules you authored (a blocking rule is a serious
  finding, a `prefer` steer a minor one), and by the critic for what a pattern
  cannot say.
- **Facts** — the wiki pages whose passages bear on the words
  (`wikiContextFor`). Turn on `wiki` for this to have anything to read; with
  no page bearing on a specific claim, the critic says it could not establish
  it.
- **The rubric** — `skills/red-team-critique/SKILL.md`: what is serious, what
  is minor, and how to answer. Override it in your workspace
  (`skills/red-team-critique/SKILL.md`) to tune it to your trade.

## Which actions it reads

`gmail.send`, `release.announce`, `notify.requester` and `chat.post_message` —
the registered actions that put words outside the workspace under the
company's name. The critic reads the card each one draws (the one definition
of how a proposal reads), so it reads an announcement's words from its
release, exactly as the person approving it would.

## Where you see it

- **The agent** reads a return as the answer to its proposal — the findings,
  numbered, and "revise once, then a person decides".
- **The review card** carries a *Red team* row — who read it, on what, and
  each serious finding.
- **The ledger** keeps every return as a run of the action closed by
  `system:gate:red-team`, with the findings — so "what did the red team send
  back this month" is a query, and a later draft of the same work is counted
  as a revision.

## Customising

- **Returns before a person**: `returns:` on the gate (default 1, at most 3).
- **The rubric**: a workspace skill with the same slug replaces it.
- **The voice**: `voice.yaml`. The facts: the wiki.
