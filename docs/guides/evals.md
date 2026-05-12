# Evals

Every resource folder gets an optional `evals.yaml` — test fixtures that catch regressions before they hit production.

## Why alongside the primitive

Putting evals in the same folder as `skill.yaml` + `prompt.md` (or `workflow.yaml`, `agent.yaml`, …) means:

- A change to the prompt and its test cases lives in the same commit
- `git mv` moves the whole thing atomically
- CI walks `context/**/evals.yaml` — one rule, every resource tested
- Human reviewers see prompt + fixtures side-by-side in a PR

No separate `/tests/` tree. No separate eval harness to learn.

## File shape

```yaml
fixtures:
  - name: <human-readable-name>
    tags: [optional, tag, list]
    input:
    # whatever the block takes as input
    expect:
      - <assertion>
      - <assertion>
```

## Assertion types

| Assertion | What it checks |
|---|---|
| `field: <path>; equals: <value>` | JSON/string field exactly matches |
| `field: <path>; regex: <pattern>` | Field matches regex |
| `field: <path>; contains: <substring>` | Field contains substring |
| `rubric: "<natural-language check>"` | Runs a separate LLM with the rubric + output; passes if the LLM scores it green |
| `callsSkill: <slug>; withArgs: {...}` | (Agents only) agent invoked this skill with these args |
| `step: <name>; field: <path>; equals: <value>` | (Workflows) intermediate step output assertion |

## Per-block shapes

### Skill evals

```yaml
# context/<org>/skills/discovery_summary/evals.yaml
fixtures:
  - name: acme_discovery_call
    input:
      transcript: ...actual test transcript...
    expect:
      - field: prospect
        equals: Acme Corp
      - field: budget
        regex: '\\$\\d+k'
      - rubric: summary mentions both pain points discussed
```

### Workflow evals

End-to-end — drive the whole workflow with a trigger input, assert on final output + intermediate steps.

```yaml
# context/<org>/workflows/discovery_followup/evals.yaml
fixtures:
  - name: acme_followup_happy_path
    input:
      transcript: '...'
      prospect_name: Acme
    expect:
      - step: summary
        field: prospect
        equals: Acme
      - step: email
        field: subject
        regex: follow-?up
```

### Object evals

Classification fixtures — does the classifier correctly identify documents of this type?

```yaml
# context/<org>/objects/deal/evals.yaml
fixtures:
  - name: zoom_recording_is_a_deal
    input:
      sourceType: zoom
      content: ...renewal discussion...
    expect:
      isType: true
      linksTo: acme_corp
```

### Agent evals

Conversation fixtures — does the agent reach for the right skill, cite the right source, stay in scope?

```yaml
# context/<org>/agents/sales-assistant/evals.yaml
fixtures:
  - name: summarize_invokes_discovery_summary
    input:
      message: summarize my last call
    expect:
      - callsSkill: discovery_summary
      - response:
          regex: 'budget|timeline'
```

## Running

```bash
npm run eval                   # all fixtures, all blocks
npm run eval -- --skill draft_followup   # one skill
npm run eval -- --tag critical           # by tag
```

Each run:

1. Loads the block's current definition (skill/workflow/agent/object) from disk
2. Executes each fixture against it
3. Grades every assertion — pattern matches are synchronous, rubrics call an LLM
4. Reports pass/fail per fixture, green/red summary at the end

## CI integration

```yaml
# .github/workflows/evals.yml
- run: npm run eval
```

Fail the PR if any assertion regresses. Same eval output feeds the `improve_skill` meta-skill (Phase 5) — proposals must pass current fixtures before merging.

## Rubric LLM selection

Rubric assertions ("summary mentions both pain points") run a separate LLM call against the output. Configure per-org in `context/<org>/context.yaml`:

```yaml
evals:
  rubric_model: gpt-5.4-mini
  rubric_temperature: 0
```

Keep rubric models cheap. They see the skill's output + the rubric, not the full context, so they can afford to be small.

## Next

- [Feedback + logs](./feedback-and-logs.md) — evals ride on the same rails as 👍/👎 ratings from real runs
- [Skills](../concepts/skills.md) — the main place evals pay for themselves
