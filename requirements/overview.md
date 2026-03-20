# Product Overview

## What CoreContext Is

A managed enterprise context platform that connects systems, maps business objects, enforces policy, exposes governed skills and workflows, and continuously improves answer quality and action reliability.

## One-Line Definition

MetaCTO delivers a managed enterprise work interface over company context and actions, powered by Onyx underneath and wrapped in MetaCTO's own policy, object, workflow, and improvement layers.

## What the Customer Should Feel

- "This knows our business"
- "This respects our boundaries"
- "This can do work, not just answer"
- "This keeps getting better"

## What CoreContext Is Not

- Not "Onyx installed"
- Not a RAG demo
- Not a chat app
- The customer should never see "embeddings," "vector search," or "retrieval"

## Positioning

Onyx is the context engine, not the customer product. The product MetaCTO sells is the managed layer above Onyx: object mapping, policy enforcement, skill governance, workflow orchestration, and continuous improvement.

## Five Things Being Built

1. **Context plane** - Connectors, indexing, retrieval, citations, search
2. **Business context model** - Canonical objects, mappings, glossary, domain boundaries
3. **Execution plane** - Skills, actions, approvals, workflows, automations
4. **Control plane** - Policies, RBAC, connector health, audit, analytics, feedback
5. **Managed improvement loop** - Evals, tuning, training, rollout, adoption, governance

## What Is an Agent in CoreContext

An agent is a **packaged configuration, not code**. It's a persona + scope + capabilities stored as a database row.

| Component | What it is |
|---|---|
| **System prompt** | Identity, tone, rules, boundaries |
| **Skills** | Which skills this agent can invoke |
| **Connectors** | Which data sources it can search (Onyx source_type filter) |
| **Object types** | Which business objects it can read/create |
| **Document sets** | Scoped corpus (optional) |
| **Approval rules** | What requires HITL vs auto-run |
| **Model config** | Which LLM, temperature, max tokens |
| **Eval set** | Gold-standard test cases |
| **Langfuse project** | Observability scope |

When a user selects an agent in Chat:
1. CC loads the agent's config from DB
2. Assembles system prompt + tool definitions (scoped to that agent's skills/connectors/objects)
3. Runs the CC agent loop with that config
4. Traces to the agent's Langfuse project

An agent is NOT: a deployed microservice, a fine-tuned model, a LangGraph graph (that's the shared execution engine), or a Temporal workflow (agents can trigger those).

**For builders:** create an agent by configuring DB rows. Change behavior by editing prompts, not deploying code.
**For customers:** each team gets agents configured for their domain. Same platform, different config.

## What the Customer Sees

Five clear surfaces, not infrastructure:

| Surface | Purpose |
|---------|---------|
| **Chat** | Conversational workspace powered by agents — answers, skills, and actions |
| **Search** | Result-first interface for finding source material, records, and evidence |
| **Skills** | Reusable business actions and queries — packaged repeatable value |
| **Workflows** | Structured multi-step processes with forms, approvals, and run history |
| **Governance** | Connectors, access, object mapping, policies, analytics, and audit |
