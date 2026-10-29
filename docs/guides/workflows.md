# Workflows: a fixed procedure, agents included

A workflow is a procedure that is the same on every run: research, then a
brief, then a draft, then an editor's review, then a person's sign-off, then
publish. Each step is visible while it runs, each result is kept on the run,
and a person's gate is a Decision on Needs you.

Use a workflow when you can write the steps down in advance. Use a
[mission](../entities/mission.md) when you can only write the goal down: an
open-ended responsibility that needs the agent's judgement about what to do
next. When a mission keeps doing the same steps in the same order, it has
become a procedure, and a workflow makes that order explicit, cheaper and
checkable (ADR 0011).

The reference for every field is [the workflow entity](../entities/workflow.md).
This guide is how the pieces fit.

## The steps

| Step | What it does |
|---|---|
| `agent` | One agent does one bounded task, on its own tools and skills, and returns a result. |
| `repeat` | A group of steps runs again until a condition holds, at most `max` rounds. |
| `approve` | The run waits on a person's Decision: approve to go on, reject to stop. |
| `ask` | The run waits for a person's text, unless its `default` already resolves. |
| `action` | A registered action, run for real: the trust ladder runs it now or holds it on its card. |
| `sync` | Refresh named sources, so later steps read live data. |

Any step can carry a `label` (what a person reads while it runs) and a `when`
(the step is skipped when it is false).

## An agent step

```yaml
- name: research
  type: agent
  label: Researching Google's top results for "{{input.keyword}}"
  agent: serp-analyst
  task: >-
    Research Google's top results for "{{input.keyword}}" for page
    {{input.page_id}} and save the SERP brief as an artifact.
  effort: standard
  tools: [web_search, fetch_url, create_artifact]
  output:
    type: object
    required: [briefArtifactId, summary]
    properties:
      briefArtifactId: {type: integer}
      summary: {type: string}
```

- **The task is an instruction, not a skill.** The agent reads whichever of
  its skills fit, on its own judgement, as it does in chat. The step bounds
  the task; it does not pick the method.
- **`output` is the result's shape.** The agent is told to end with one JSON
  object of that shape. The result is validated. A wrong shape gets one
  corrective turn that names exactly what was wrong; a second wrong shape
  fails the step with that reason. Later steps read the fields as
  `{{steps.research.output.briefArtifactId}}`. Without `output`, the step's
  output is the agent's reply as text.
- **`effort`** is the turn's envelope: `quick`, `standard`, `deep`, or `auto`
  (the default, read from the task). It sets the model, the thinking, and the
  turn's time and spend ceilings, as it does for a chat turn.
- **`tools`** narrows the agent to the tools named. Without it the agent has
  its own tools. Grants and exclusions still apply first, and the agent can
  always read its skills.
- **The turn belongs to the run.** Its spend is charged to the workflow run,
  and the step keeps the model that answered, the effort it ran at, what it
  cost, its trace, and every try at the result.

## A bounded repeat

```yaml
- name: edit
  type: repeat
  label: Editor review
  until: "{{steps.review.output.verdict}} == 'pass'"
  max: 3
  onExhausted: continue
  steps:
    - name: review
      type: agent
      agent: seo-editor
      task: Review draft {{steps.draft.output.draftArtifactId}} against the brief.
      output:
        type: object
        required: [verdict, findings]
        properties:
          verdict: {enum: [pass, revise]}
          findings: {type: array, items: {type: string}}
    - name: revise
      type: agent
      agent: seo-writer
      task: >-
        Revise draft {{steps.draft.output.draftArtifactId}} to resolve these
        findings: {{steps.review.output.findings}}
```

The group's steps run in order. `until` is checked after each of them, so the
group stops the moment it holds: a review that passes ends the group before
the revision. When `max` rounds have run and `until` never held,
`onExhausted: continue` goes on to the next step (a sign-off that shows the
open findings), and `onExhausted: fail` fails the run. Inside the group,
`{{repeat.round}}` and `{{repeat.max}}` are the round and the ceiling, and each
step's label says "round 2 of 3" on its own.

A group holds `agent`, `action` and `sync` steps. A person's gate goes after
the group, not inside it, and groups do not nest. An action held on its card
waits inside the group, and a failed action is a failed round: the group goes
on, `{{steps.<name>.output.ok}}` is false, and `until`, `max` and
`onExhausted` decide. After the group,
`{{steps.edit.output.rounds}}` is how many rounds ran and
`{{steps.edit.output.satisfied}}` whether `until` held.

## An action step

```yaml
- name: publish
  type: action
  label: Publishing the page
  when: "{{input.publish_target}} != 'none'"
  action: site.publish_page
  input:
    pageRecordId: '{{input.page_id}}'
```

The step proposes the registered action the way an agent's `propose_action`
does, as the workflow's owning agent, so **the trust ladder decides**: a kind
the ladder releases runs now, and anything else waits on the action's own
card in Review and on Needs you, where it is approved or turned down like
every other card. The run waits with it (the step reads "Waiting on a
person"). Approving runs the action and the run goes on; turning it down stops
the run with the reason; stopping the run withdraws the card.

- **What goes out or cannot be undone always waits.** An action on the
  platform's never-auto list, one that says every run needs a person, or one
  that reaches outside the workspace with no Undo (`site.publish_live`, a
  sent email) is held for a person whatever the trust rule, and its card never
  offers "Always allow".
- **The result is the step's output:** `{{steps.publish.output.ok}}`,
  `.status` (`done`, `failed`, …), `.actionRunId`, and `.result`, the
  action's own result (`{{steps.publish.output.result.url}}`).
- **A failure fails the step:** an input the action refuses, its own check,
  or an execution that throws. Outside a repeat group that fails the run with
  the action's words; inside one it is a failed round.
- **`confidence`** (0–1, or a reference such as
  `{{steps.review.output.confidence}}`) is what the ladder weighs against a
  trust rule's floor. The default is 1: the procedure asks for the step
  outright, and the kind's rung, risk and reversibility decide.
- `workflow.start` and `routine.run` run in the engine itself. An id no action
  is registered under records what it would have done.

## Conditions

`when` and `until` are one comparison or one value:

| Condition | True when |
|---|---|
| `"{{input.target}} != 'none'"` | the target is anything but `none` (a missing value reads as empty) |
| `"{{steps.review.output.verdict}} == 'pass'"` | the verdict is `pass` |
| `"{{steps.check.output.ready}}"` | the value holds something: not missing, empty, `false`, `0`, `no` or an empty list |

Each side is a `{{reference}}`, a quoted string, a number, `true`, `false` or
`null`. Anything else, and two fixed values compared with each other, fail at
`workspace:check`, so a typo never silently skips a step. Quote the whole
condition in YAML: it starts with `{`.

## Names a person reads

A workflow's `runLabel` names each run from its input when it starts:

```yaml
runLabel: '{{input.batch_ref}} · page {{input.index}} of {{input.total}}'
```

The run is listed by that name, with the label of the step it is on, in the
workflows pages, Activity, Needs you and the chat's running-work line: "SB-512
· page 2 of 3", "Editor review · round 2 of 3". A caller that already knows
the record can name the run itself by passing `runLabel` in the input. A step
without a `label` is named by the first sentence of its task or prompt.

## A person's gate

An `approve` step files one Decision: its label and the run's name as the
title, its prompt as the question, and what it `reviews` (another step's
result) laid out underneath. It is decided like any other Decision: on its
card, on Needs you, with a chip in the chat, or in a person's own words.
Approving resumes the run and records who approved it and their note on the
step (`{{steps.signoff.output.note}}`). Rejecting it, or skipping it, stops
the run with the reason. A run resumed or stopped anywhere else closes its
Decision.

## One run per item

To run the same procedure for every item in a list, a parent starts one child
run per item with the `workflow.start` action:

```yaml
- name: pages
  type: action
  label: Starting one run per page
  action: workflow.start
  input:
    workflow: seo-page
    items: '{{input.pages}}'
    input:
      batch_ref: '{{input.batch_ref}}'
```

Each child's input is the shared `input`, then the item's own fields when it
is an object, then `item`, `index` (from 1) and `total`. Each child is named by
its own `runLabel`, runs, pauses and is decided on its own, and records its
parent (`{{trigger.parentRunId}}`). The step finishes once the children have
started; it does not wait for them. One step starts at most 50.

## When the server restarts

Each run is owned by a durable run that survives restarts and deploys. Every
finished step is written before the next starts, so a restart re-runs only the
step it interrupted, from its start, and the step says how many times it
started. A step interrupted three times fails rather than loop. A repeat group
picks up at its round and step. A run waiting on a person waits as long as it
takes.

## Worked example: an SEO page pipeline

Northwind Home Services is writing a batch of local pages. Each page is
researched, briefed, drafted, reviewed by the editor at most three times,
signed off by a person, and published unless the batch has no publish target.

```yaml
slug: seo-page
name: Write and publish one SEO page
description: Research, draft, editor review and sign-off for one page of a batch.
agent: seo-strategist
runLabel: '{{input.batch_ref}} · page {{input.index}} of {{input.total}}: {{input.keyword}}'
trigger:
  type: manual
inputSchema:
  type: object
  required: [page_id, keyword, batch_ref]
  properties:
    page_id: {type: integer}
    keyword: {type: string}
    location: {type: string}
    client: {type: string}
    batch_ref: {type: string}
    publish_target: {type: string}
steps:
  - name: research
    type: agent
    label: Researching Google's top results for "{{input.keyword}}"
    agent: serp-analyst
    task: >-
      Research Google's top results for "{{input.keyword}}" in
      {{input.location}} for page {{input.page_id}}, and save the SERP brief
      as an artifact.
    effort: standard
    output:
      type: object
      required: [briefArtifactId, summary]
      properties:
        briefArtifactId: {type: integer}
        summary: {type: string}

  - name: draft
    type: agent
    label: Writing the draft
    agent: seo-writer
    task: >-
      Write page {{input.page_id}} for "{{input.keyword}}" from the SERP brief
      (artifact {{steps.research.output.briefArtifactId}}), in
      {{input.client}}'s voice. Save it as a draft artifact.
    effort: deep
    output:
      type: object
      required: [draftArtifactId]
      properties:
        draftArtifactId: {type: integer}

  - name: edit
    type: repeat
    label: Editor review
    until: "{{steps.review.output.verdict}} == 'pass'"
    max: 3
    onExhausted: continue
    steps:
      - name: review
        type: agent
        agent: seo-editor
        task: >-
          Review draft artifact {{steps.draft.output.draftArtifactId}} against
          the SERP brief (artifact {{steps.research.output.briefArtifactId}}).
          Pass it, or list what must change.
        output:
          type: object
          required: [verdict, findings]
          properties:
            verdict: {enum: [pass, revise]}
            findings: {type: array, items: {type: string}}
      - name: revise
        type: agent
        label: Revising from the editor's notes
        agent: seo-writer
        task: >-
          Revise draft artifact {{steps.draft.output.draftArtifactId}} to
          resolve these findings: {{steps.review.output.findings}}. Save a new
          version of the same artifact.

  - name: signoff
    type: approve
    label: Sign off the page
    prompt: >-
      Sign off "{{input.keyword}}" for {{input.client}}. After
      {{steps.edit.output.rounds}} editor rounds the verdict is
      {{steps.review.output.verdict}}; open findings are listed below.
    reviews: review

  - name: publish
    type: action
    when: "{{input.publish_target}} != 'none'"
    action: site.publish_page
    input:
      pageRecordId: '{{input.page_id}}'
```

And the batch that starts one run per page:

```yaml
slug: seo-batch
name: Write a batch of SEO pages
agent: seo-strategist
runLabel: '{{input.batch_ref}}: {{input.client}}'
trigger:
  type: manual
steps:
  - name: pages
    type: action
    label: Starting one run per page
    action: workflow.start
    input:
      workflow: seo-page
      items: '{{input.pages}}'
      input:
        batch_ref: '{{input.batch_ref}}'
        client: '{{input.client}}'
        publish_target: '{{input.publish_target}}'
```

Started with three pages for batch SB-512, the work line shows three runs:
"SB-512 · page 1 of 3: boiler repair", and so on, each with the step it is on.
A page whose editor passes it on the second round goes straight to its
sign-off; a page still failing after the third round goes to its sign-off with
the editor's open findings on the card. Rejecting a sign-off stops that page's
run and no other.

`publish` runs `site.publish_page` for real. Publishing reaches the client's
site, so after the sign-off the run waits once more, on the publish card
itself ("Publish "Boiler repair in Larkfield" → Northwind site"): what
reaches a client's site is approved on its own card. Approving it opens the
pull request (or saves the Squarespace draft), and the step's output carries
the action's result, its link included.
