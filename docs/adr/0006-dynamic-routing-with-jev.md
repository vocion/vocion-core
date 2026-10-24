# ADR 0006 — Dynamic routing with Jev: a key turns it on

- **Status:** accepted 2026-10-23
- **Date:** 2026-10-23
- **Owners:** Jamie Schiesel (direction: Jev classifies agent, model and effort; a key turns it
  on; instance key with workspace override; Vocion never depends on Jev); the Software Factory
- **Related:** ADR 0005 (engines, scoreboard, static router), `services/routing/jev.ts`,
  `services/routing/jevKey.ts`, `services/routing/route.ts`, `routers/Routing.ts`,
  `services/factory/engineRun.ts`, migration `0217_routing_key.sql`

## Context

ADR 0005 shipped a static router (the task's engine, else the seat's, else the default, inside the
installation's fence) and a scoreboard, and left a hook for routing by task complexity or cost.

Jev is TypeSafe's decision model, served through OpenRouter. It answers typed questions about a
state object (`choice`, `score`, `noul`) with probabilities, not text, in well under a second. It is
reached with an OpenRouter API key on the Decisions API, `POST https://openrouter.ai/api/alpha/decisions`
(alpha). OpenRouter also sells a packaged router, `typesafe/jev-router`, that picks a model **and
generates the reply** through Chat Completions.

Shapes this ADR relies on, read from the live docs on 2026-10-23 (openrouter.ai Jev hub, tutorial,
Decisions API reference, Jev Router page; jev-recipes `model-route`):

- Request: `{ model, state, questions }`; `questions` keyed by our own ids; a `choice` has
  `criteria` mapping option → description; a `score` has `criteria` as an ordered array.
- Response: `{ id, model (the dated build), provider, answers, usage: { input_tokens,
  output_tokens, cost (USD) } }`; each answer carries `type`; a choice answer has `choice`,
  `confidence`, `probabilities`; a score answer has `score` (probability-weighted index),
  `confidence`, `probabilities`, `legend`.
- Models: `typesafe/jev-1.14` is current (alias `~typesafe/jev-latest`); `typesafe/jev-1.13` is
  still served. The only published accuracy figures for model routing (jev-recipes `model-route`,
  2026-10-04: 98% accurate on the decisions it marked ready, 64 of 104 cases) were measured on 1.13.

## Decisions

### 1. Jev is a classifier, on the Decisions API, with the model pinned

Vocion asks Jev; Vocion keeps its own policy and does the generation. We do not use
`typesafe/jev-router`: factory engines (claude-cli, openhands, later codex) run their own model
loops inside the runner, and the decision is needed **before** the run starts, to put the engine,
model and effort on the contract.

Pinned to `typesafe/jev-1.13` (the version the routing figures were measured on; thresholds are
per version), configurable with `VOCION_JEV_MODEL` (e.g. `typesafe/jev-1.14`). Never the `latest`
alias by default: a silent model change would move every threshold.

### 2. What Jev picks, and from what

One request, two questions:

- `candidate` (choice): which of the seat's candidates should do the work, plus `none`. Each
  candidate is an engine and model **described by what it is good at and its relative cost**, as
  the `model-route` recipe advises ("prefer the cheapest candidate whose description covers the
  work"). Ids are opaque (`c1`, `c2`, …); the mapping back to engine and model is ours.
- `effort` (score): low / medium / high, as an ordered rubric. The rounded score is the level.

State is facts at dispatch: the task title and objective (truncated), acceptance criteria count,
planned paths, size (`complexityOf`, the scoreboard's own size field), risk class, repository and
budget. No secrets, no customer data beyond what the task already says.

Candidates come from the seat: `harness.routeModels` (engine, model, `about`, `cost`; at most 12).
A seat that declares none offers its own engine and model as the one candidate, and Jev then picks
the **effort only**. That is the default on purpose: Jev never moves real work onto a model the
workspace did not name.

### 3. Hard limits come first and Jev cannot override them

In order: the installation's fence (`VOCION_ALLOWED_ENGINES`; a client installation lists only open
engines) removes candidates before Jev sees them; the seat's declared models are the only models;
the run's budget is the contract's `budget` and the runner's wall clock, which Jev does not touch.
A task that names its own engine or pins its own model policy is a person's decision and is not
put to Jev.

Jev's answer is used only if it is `ready` in our terms: the choice is one of the candidates (not
`none`, not anything else) and its confidence is at least `VOCION_JEV_MIN_CONFIDENCE` (default
0.6). Otherwise the run takes the static route. The fence is checked again on what Jev chose, so
a bug in the candidate filter clamps rather than runs. The effort is used only if its own
confidence clears the same bar; otherwise the seat's effort stands (and with one candidate, where
the effort was the whole question, the run goes static).

### 4. A key turns it on; nothing depends on Jev

No key: behaviour is exactly ADR 0005, and Jev is never called. Any Jev error, a timeout
(`VOCION_JEV_TIMEOUT_MS`, default 3000), any 4xx/5xx, or a body that is not the documented shape
falls back to the static route. No run fails because of Jev. Plain `fetch`, no SDK, nothing in
`package.json`: installing Vocion does not install Jev.

### 5. Where the key lives

Resolution: the **workspace** override, then the **instance** key, then off.

- Instance key: **System** (`/dashboard/admin`) → *Dynamic routing (Jev)*. Stored in
  `routing_key` (`holder = 'instance'`), encrypted with the credential vault (KMS-wrapped DEK in
  production, the same AES-256-GCM columns as `user_mfa` / `api_token`), under the vault scope
  `instance`. A self-hoster can set `VOCION_JEV_API_KEY` instead; a saved key takes its place.
  On a single-Org server (core's only mode) the Org is the installation, so a workspace admin may
  set it, as with the Org's brand. On a multi-Org server the card is read-only and the key comes
  from the environment: one customer's admin must not set every customer's key.
- Workspace override: **Developers** (`/dashboard/developers`) → *Dynamic routing (Jev)*, admins
  only. Stored in `routing_key` (`holder = 'workspace:<id>'`) under the workspace's own DEK.
  Never in workspace YAML or git. A client workspace with its own key bills and tracks on its own
  OpenRouter account.
- Keys are write-only: the cards and the API return the last four characters, who saved it and
  when; nothing returns a key except the resolver, whose only caller hands it to `fetch`. Keys are
  never logged and never put in an error. A workspace key that will not decrypt does **not** fall
  through to the instance key (that would bill the wrong account): the run goes static and says why.

We did not reuse the platform credential registry (`api_token`, Settings → Credentials): those
keys are revealable by admins by design, and the instance level has no row there.

### 6. Scope

Wired into the factory engine router (dispatch, `factory-dispatch.ts`), where ADR 0005 left the
hook. `routeEngine` stays the synchronous static answer; `routeTask` wraps it. The engine goes on
`contract.engine`; a claude-cli model on `model_policy.model` (and `engine.model`); an engine's own
model on `engine.model`; effort on `model_policy.effort`, which both engines already pass to their
model (`--effort` / `reasoning_effort`). The runner is unchanged.

**Phase 2, not in this change:** core agent runs (chat and missions). Their model and effort are
chosen in more than one place (`services/agents/effort.ts` already infers effort with a model call;
the strength ladder in `libs/llm/modelPrefs.ts`; per-agent harness models). Putting Jev behind
`inferEffort` is the natural first step, behind the same key.

### 7. Observability

Every routed run records on its input `route`: `selector` (`static` | `jev`), the reason, the model
and effort chosen, and `jev` = `RouteDetail` (asked, candidates, choice, confidence, effort and its
confidence, the Jev build that answered, latency, cost in USD when OpenRouter reports it, key scope
`instance` | `workspace` — never the key — and the fallback reason). The scoreboard copies these to
`engine_run.route_selector` / `route_detail` (migration 0217) and counts, per engine, Jev picks,
static routes and fallbacks. The Engines page shows the counts as *Routed by*, a `jev` / `static`
badge with Jev's numbers in the *Why this engine* column, and whether routing is on and on whose key.

### 8. Tests

No key means Jev is never called; a workspace key beats the instance key, which beats the
environment; a pick outside the fenced candidates is clamped to the static route; timeouts, HTTP
errors, network errors and malformed bodies fall back; the documented response maps to engine,
model and effort and onto the contract; members cannot set keys; no route returns a key. CI never
calls Jev (fetch is faked).

## Consequences

- With no key anywhere, nothing changes. The deploy that ships this is inert until a key is saved.
- With a key and no `routeModels`, Jev sets the effort of each run (low / medium / high) on the
  seat's own engine and model. Engine and model choice start when a seat declares candidates.
- Each dispatch with a key waits for Jev, at most the timeout (3 s by default; typical answers are
  well under a second). Cost is per input token (output is free), about $0.00002 per decision at
  the tutorial's size.
- The Decisions API is **alpha**: its shape may change. A change shows up as fallbacks with
  "the response carried no answers" (or similar) on the Engines page, never as failed runs.

## Rollback

Remove the key (System and/or Developers; unset `VOCION_JEV_API_KEY`). Routing is static at the
next dispatch. Nothing else needs undoing; the recorded routes stay on the board as history.
