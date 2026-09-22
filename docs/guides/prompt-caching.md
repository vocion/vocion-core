# Prompt caching

An agent turn re-sends the whole conversation. The system prompt, the tool list, the
mounted playbook and the learning rules are identical on turn 12 and turn 1, and without a
cache the vendor charges full input price for those same bytes every time.

Vocion asks Anthropic and Bedrock to cache that prefix on every call, by default, with no
configuration. This page says what that changes, what it does not cache, how to read the
numbers, and how to turn it off.

## What it saves

Two separate things, and the second one is the reason this exists.

**A cache read is billed at 10% of the input rate.** On Bedrock a cache *write* costs 1.25x
input for the five-minute TTL Vocion sends, so the first call of a run costs slightly more
and every call after it costs a tenth for the cached part.

**A cache read does not count against the account's tokens-per-day quota at all.** AWS is
explicit about it:

> CacheReadInputTokenCount don't contribute to this calculation and are not counted toward
> your quota.

— <https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html>

That is what makes the difference between a run that finishes and a run that stops. The
ingestion agent measured below hit its Sonnet 4.6 daily quota twice in September 2026 and stopped
with `ThrottlingException: Too many tokens per day`. Cached tokens are invisible to that
quota, so the same work fits inside the same day.

The measurement behind the change: dev mission run 24 (2026-09-09, from CloudWatch
`AWS/Bedrock` metrics) made 44 model calls in six minutes for 3.26M input tokens against
20k output tokens. The first call carried about 18k tokens of prefix; the last about 93k.

## What is cached

The prefix, not the newest message. On Bedrock the instruction becomes Converse
`cachePoint` blocks in three places — the end of the tool list, the end of the system
blocks, and the end of the last message — so consecutive turns of one run match on
everything they share. On Anthropic it is `cache_control` on the system block.

This is on for:

- every agent turn, on Anthropic and on Bedrock, through `buildChatModel`;
- the agent-runtime artifact (BYOA), through its own `buildChatModel`;
- the raw one-shot adapters in `libs/llm/bedrock.ts` and `libs/llm/anthropic.ts`, which
  cache their system block — the shape a repeated extraction call takes, where the schema,
  the rules and the few-shot examples are the same on every document;
- eval cases, which re-run one prefix across a dataset.

OpenAI is untouched: its caching is automatic and has no per-call switch.

## What silently does not cache

**A prefix shorter than the model's minimum.** The request succeeds, nothing is cached,
and `cacheWriteTokens` comes back 0. There is no warning. The minimums:

| Model | Minimum cacheable prefix |
|---|---|
| Opus 5, Fable 5 / 5.1, Mythos 5 / 5.1 | 512 tokens |
| Sonnet 4.5, Sonnet 4.6, Sonnet 5, Opus 4.8 | 1,024 tokens |
| Haiku 4.5, Opus 4.5 / 4.6 / 4.7 | 4,096 tokens |

From <https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html> and
<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>, both read
2026-09-22. `minimumCacheableTokens()` in `libs/llm/promptCache.ts` holds the same table and
accepts a decorated Bedrock id.

The one that bites: the **`classifier` role defaults to Haiku 4.5**, whose minimum is
4,096 tokens. A short classifier prompt will not cache no matter what is asked for. Padding
it past the minimum only helps if the padding is real content the call needs anyway — rules
and worked examples, not filler.

**A prefix that is written and never read back.** A cache write costs 1.25x input, so a
one-off call with no follow-up is a small loss. Everything caching is on for here reads the
prefix back within seconds.

**A prefix that changed.** The cache keys on the bytes up to the cache point, so anything
that varies per call — a timestamp in the system prompt, a re-ordered tool list — misses
every time.

## Reading the numbers

Bedrock reports `inputTokens` as the **uncached remainder only**. The whole input side is
`inputTokens + cacheReadInputTokens + cacheWriteInputTokens`. Vocion's adapters do that sum
before filling in `TokenUsage`, so `usage.inputTokens` means the same thing everywhere in
this codebase: every input token the call was billed for, cached ones included.

- **Langfuse's own UI** (http://localhost:3200, reached from the deep links on
  `/dashboard/observability`) stamps `cache_read_input_tokens` and
  `cache_creation_input_tokens` on every generation. This is the only place the
  read/write split is visible: `/dashboard/observability` itself shows spend,
  runs and active agents, with the cache discount already folded into the spend
  figure rather than broken out.
- **`TokenUsage`** carries `cacheReadTokens` and `cacheWriteTokens`; `RunUsage` sums both
  per turn and hands them to the cost calculation and to `chargeUsage`.
- **CloudWatch**, for the Bedrock-side truth: `CacheReadInputTokenCount` and
  `CacheWriteInputTokenCount` under `AWS/Bedrock`, against `InputTokenCount`.

Pricing follows the split: a cache read is charged at `cacheReadCentsPerMillion`, a cache
write at 1.25x input unless a tier names its own rate, and both come off `inputTokens`
before the rest is charged at the plain rate (`libs/pricing.ts`).

A warm run reads roughly: cache write large on the first call, 0 after it; cache read large
on every call after the first. Cache read 0 on turn 2 means the prefix was under the
minimum, or it changed.

## Turning it off

Three levels, narrowest first.

**One agent**, in workspace YAML:

```yaml
harness:
  promptCache: false
```

This beats the caller, because the person who wrote the agent is the one who knows what its
prompt carries. Leave it out to get the default.

**One call site**, in code: `buildChatModel('main', { promptCache: false })`.

**The whole process**: `VOCION_PROMPT_CACHE=0` (`false` and `off` also work). This is the
escape hatch for a vendor-side cache bug, and the way to measure what caching is actually
saving — run the same work twice, once with it set.

## Where the code is

| What | Where |
|---|---|
| The mechanism | `packages/core/src/libs/llm/promptCache.ts` |
| Same module for the BYOA artifact | `packages/agent-runtime/src/promptCache.ts` |
| Choosing the caching class | `libs/llm/langchain.ts` (`buildChatModel`), `packages/agent-runtime/src/model.ts` |
| Raw one-shot adapters | `libs/llm/bedrock.ts`, `libs/llm/anthropic.ts` |
| Per-agent switch | `libs/workspace/schemas.ts` (`harness.promptCache`) → `services/agents/harness.ts` |
| Cost | `libs/pricing.ts` |
| Trace | `libs/Langfuse.ts` |

The two `promptCache.ts` files are deliberate copies: the runtime artifact is bundled and
deployed separately and cannot import core. Change one, change the other.
