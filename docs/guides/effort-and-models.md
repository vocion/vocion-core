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

**Dig deeper** on an answer asks the same question again one level up. A Standard answer on the agent's own model re-runs on the strongest one.

## What the answer says

The line under every answer names the level, the model and the time: **Deep · Opus 5.5 · 44s**. The model is the one the turn actually ran on (from the `run_meta` event), written as family and version, never as a vendor id. The Langfuse trace carries the same choice under `metadata.effort`.

## Pointing a level at another model

A deployment can repoint the fast or strongest model without touching code:

```bash
VOCION_MODEL_DEEP_ANTHROPIC=claude-opus-5-5
VOCION_MODEL_FAST_ANTHROPIC=claude-haiku-4-5-20251001
VOCION_MODEL_DEEP_BEDROCK=us.anthropic.claude-opus-5-v1:0
```

The gauge and the turn line follow whatever the turn ran on. Price any new model in `libs/pricing.ts` first, or its spend reads as zero.

## What is not affected

Missions, automations and evals run on the agent's own model and settings. Teammates consulted through `task` run on the classifier model. To compare two models on the same work before changing an agent, use the [model-upgrade test](./model-upgrade-test.md).
