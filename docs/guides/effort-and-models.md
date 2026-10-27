# Effort and models

A chat turn runs at **Quick**, **Standard** or **Deep**, and the level chooses the model as well as how hard the turn works. There is one control, the effort gauge in the composer, and every answer says which model wrote it.

## What each level runs on

| Level | Model (Anthropic) | Thinking | Teammates | Aims for | Ceilings |
|---|---|---|---|---|---|
| Quick | the vendor's fast model (Haiku 4.5) | off | none | 8s | 40s, 15¢ |
| Standard | the agent's own model | the agent's own | one | 20s | 90s, 75¢ |
| Deep | the vendor's strongest (Opus 5.5) | high | several, side by side | 150s | 600s, $5 |

On OpenAI the fast and strongest models are `gpt-4o-mini` and `gpt-4o`; on Bedrock they are the Haiku 4.5 and Opus inference profiles. Standard never changes the model: an agent pinned to a model in its YAML (`harness.model`) runs on it at Standard, and on the deployment default when it names none.

## How the level is chosen

1. The gauge, per message. Pick Quick, Standard or Deep before sending; each level shows the model it leads with, and Standard reads "This agent's model".
2. Otherwise the agent's `harness.turnEffort`, or the workspace's `defaults.turnEffort`.
3. Otherwise **Auto**: a small model reads the request and picks the level. Ranking, risk analysis across many items, research and plans go to Deep; a lookup goes to Quick.

Auto also reports typed facts about the request, and code applies the rules on them (`effort.ts`); the person's words are never matched:

| Fact | Rule |
|---|---|
| `drafts`: it writes or revises something a person will send | Never Quick |
| `systems`: how many systems it needs checked | 2 or more is never Quick |
| `changes`: how many records it changes or decides | 2 or more is never Quick |
| `teams`: how many teams' work the answer brings together | 2 or more runs **Deep** when the agent is a lead with teammates (`synthesisLevel`) |
| `owed`: it asks what is owed, open or pending on a client, account, person or deal | never Quick |
| `analysis`: `chart` when it asks for a chart or an analysis to look at; `multi` when that analysis spans more than one statement or scenario | `chart` is never Quick; `multi` runs **Deep** |

`owed` is there because what is owed on an account lives in several places at once: Review items any agent raised, approved Gmail drafts not yet sent, tracker rows, the project and the last call. "What do I owe on <client>?" once ran Quick, counted one system and missed the approved follow-up email in Review. Such a question is answered with `owed_on_account`, which joins all of them by the account's domains, addresses and project (`services/accounts/owedOnAccount.ts`).

`analysis` is there because choosing a chart's form is the analyst's work, and the library cannot choose it for the model. On 2026-10-24 "chart that" ran Quick on the fast model and drew a P&L bridge whose last five steps were hairlines. A chart turn now runs at least Standard, and one across statements or scenarios (the P&L and the balance sheet; low, base and high cases) runs Deep. Its line reads **Standard · building a chart** or **Deep · analysis across statements or scenarios**. See `docs/guides/charts.md`.

The `teams` rule is for the workspace lead's status questions ("how's my GTM work this week?"): the lead weighs its teammates' answers into one picture, which is Deep's job. Its line reads **Deep · synthesizing 3 teams**. The teammates it consults inside the turn are not raised. An agent with no teammates, a one-team question, or a person's own choice on the gauge is left as it was.

**Dig deeper** on an answer asks the same question again one level up. A Standard answer on the agent's own model re-runs on the strongest one.

## What the answer says

The line under every answer names the level, the model and the time: **Deep · Opus 5.5 · 44s**. The model is the one the turn actually ran on (from the `run_meta` event), written as family and version, never as a vendor id. The Langfuse trace carries the same choice under `metadata.effort`.

## Pointing a level at another model

A deployment can repoint the fast or strongest model without touching code:

```bash
VOCION_MODEL_DEEP_ANTHROPIC=claude-opus-5-5
VOCION_MODEL_FAST_ANTHROPIC=claude-haiku-4-5-20251001
```

The gauge and the turn line follow whatever the turn ran on. Price any new model in `libs/pricing.ts` first, or its spend reads as zero.

## What is not affected

Missions, automations and evals run on the agent's own model and settings. Teammates consulted through `task` run on the classifier model. To compare two models on the same work before changing an agent, use the [model-upgrade test](./model-upgrade-test.md).
