# Managed Operations

This is where recurring revenue lives.

## Connector Operations

- Broken tokens (re-auth, credential rotation)
- Schema changes (source system API updates)
- Sync lag (monitoring and alerting)
- Source drift (new fields, deprecated endpoints)
- New systems (onboarding additional connectors)

## Permission Operations

- Role changes (promotions, team moves, departures)
- Access drift (periodic access review)
- Audit questions (compliance inquiries)
- Exception handling (temporary elevated access)

## Relevance Tuning

Do not start with model fine-tuning. Start with:

1. **Source weighting** - prioritize authoritative sources
2. **Freshness weighting** - prefer recent over stale
3. **Object match weighting** - boost results matching the business object in scope
4. **Authoritative-source priority** - official docs over Slack chatter
5. **Query rewriting** - expand and clarify ambiguous queries
6. **Synonym and taxonomy expansion** - map business terminology
7. **Skill-specific retrieval scopes** - narrow retrieval per skill

Onyx already does hybrid search and knowledge-based retrieval. The job is to make it business-aware.

## Prompt and Skill Tuning

- Prompt versions (track, compare, rollback)
- Response templates (standard output formats)
- Variable defaults (pre-fill common inputs)
- Escalation thresholds (when to flag for human review)
- Approval rules (when actions need sign-off)
- Error handling (graceful degradation, fallback responses)

## Eval Loop

### Inputs
- Thumbs up/down
- Correction notes
- Bad source reports
- False-positive actions
- Approval rejections
- Latency/cost outliers

### Outputs
- Offline eval suites
- Regression testing
- Release gates (skills don't ship without passing evals)

## Workflow Tuning

- Retry policies
- Timeout policies
- Idempotency guarantees
- Handoff points (human/agent boundaries)
- Notification logic (who gets notified, when)

## Training

### User Training

- How to scope questions effectively
- When to use search vs skills vs workflows
- How to inspect evidence and citations
- How to give useful feedback

### System Training

Mostly not model training. It is:

- Better mappings
- Better retrieval policies
- Better skills
- Better evals
- Better prompts
- Better guardrails

Fine-tuning should be rare early on. Use it later for narrow extraction/classification jobs if there is enough repeat volume and clear signal.
