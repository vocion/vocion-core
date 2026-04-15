# Worked example: discovery follow-up

A concrete, copy-paste build of one workflow end-to-end: a prospect finishes a discovery call, Vocion summarizes the transcript, drafts a follow-up email in your voice, waits for your approval, and then (in v2) sends it.

Uses every resource. Takes ~30 minutes if you have Zoom + Gmail already connected as Sources.

## What you'll end up with

```
context/<org>/
├── sources/
│   └── zoom/source.yaml
├── objects/
│   └── discovery-call/
│       ├── type.yaml
│       └── classification-prompt.md
├── skills/
│   ├── discovery-summary/
│   │   ├── skill.yaml
│   │   ├── prompt.md
│   │   └── evals.yaml
│   └── draft-followup-email/
│       ├── skill.yaml
│       ├── prompt.md
│       └── postprocess.js
├── workflows/
│   └── discovery-followup/
│       ├── workflow.yaml
│       └── evals.yaml
└── agents/
    └── ziggy/
        ├── agent.yaml
        └── system-prompt.md
```

Every file below is a real shape you can paste and adapt.

## 1 — Source

Zoom already has a plugin connector. Author the YAML anyway so filters and retrieval overrides live in git.

```yaml
# context/<org>/sources/zoom/source.yaml
slug: zoom
label: Zoom
description: Meeting transcripts + recordings for sales calls
auth:
  type: oauth2
  scopes: [meeting.read, recording.read]
retrieval:
  chunking: {size: 2000, overlap: 300} # transcripts are long; overlap more
```

## 2 — Object

What's a "discovery call" in this tenant's world? Declare it once, every skill retrieves the same canonical shape.

```yaml
# context/<org>/objects/discovery-call/type.yaml
slug: discovery_call
label: Discovery Call
description: Initial prospecting conversation — qualifying budget, pain, timeline
icon: phone
sourceRelevance:
  zoom: 2.0
  hubspot: 1.5
  gmail: 1.2
```

```markdown
<!-- context/<org>/objects/discovery-call/classification-prompt.md -->
A Zoom recording counts as a discovery_call if the meeting title contains
"discovery" OR the transcript includes pricing/budget/timeline discussion
in the first 10 minutes. Exclude:
- renewal calls (existing customer)
- internal team meetings
- demo-only calls (no discovery)
```

## 3 — Skill (prompt form)

Structured summary skill — input: transcript; output: structured JSON-ish text.

```yaml
# context/<org>/skills/discovery-summary/skill.yaml
slug: discovery_summary
name: Discovery Summary
description: Extract prospect, pain, budget, timeline from a call transcript
category: query
model: gpt-5.4-mini
temperature: '0.2'
requiresApproval: false
promptFile: prompt.md
inputSchema:
  type: object
  required: [transcript]
  properties:
    transcript: {type: string}
    meeting_title: {type: string}
```

```markdown
<!-- context/<org>/skills/discovery-summary/prompt.md -->
You're analyzing a discovery call transcript. Extract:

- **Prospect** (name + company)
- **Pain** (top 2–3 specific pain points)
- **Budget** (number + timing; or "not discussed")
- **Timeline** (decision deadline)
- **Next steps** (what the prospect committed to)

Meeting: {{meeting_title}}

Transcript:
{{transcript}}

Return clean markdown. Don't preamble.
```

```yaml
# context/<org>/skills/discovery-summary/evals.yaml
fixtures:
  - name: acme_budget_explicit
    input:
      meeting_title: Acme / Jane Smith — discovery
      transcript: '...'
    expect:
      - field: prospect
        contains: Acme
      - rubric: budget section mentions a concrete dollar amount
```

## 4 — Skill (prompt + script)

Draft email skill — demonstrates the postprocess sidecar pattern.

```yaml
# context/<org>/skills/draft-followup-email/skill.yaml
slug: draft_followup_email
name: Draft Follow-up Email
description: Draft a post-discovery follow-up email in Chris's voice
category: mutation
model: gpt-5.4
temperature: '0.35'
requiresApproval: true # lands in the review queue — this goes to a real prospect
promptFile: prompt.md
scriptFile: postprocess.js # strip "Sure, here's..." preambles etc.
inputSchema:
  type: object
  required: [discovery_summary, prospect_name]
```

```js
// context/<org>/skills/draft-followup-email/postprocess.js
export default function postprocess(output) {
  if (typeof output !== 'string') {
    return output;
  }
  return output
    .replace(/^sure[,!]?\s+here[^\n]*\n+/i, '')
    .replace(/^certainly[,!]?\s*\n/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

## 5 — Workflow

Chain the two skills + an approval gate + a send action.

```yaml
# context/<org>/workflows/discovery-followup/workflow.yaml
slug: discovery_followup
name: Discovery Follow-up
description: Summarize the call, draft the email, gate on approval, send.
trigger: {type: manual}
inputSchema:
  type: object
  required: [transcript, prospect_name, prospect_email]
steps:
  - name: summary
    type: skill
    skill: discovery_summary
    input:
      transcript: '{{input.transcript}}'
  - name: email
    type: skill
    skill: draft_followup_email
    input:
      discovery_summary: '{{steps.summary.output}}'
      prospect_name: '{{input.prospect_name}}'
  - name: review
    type: approve
    prompt: Review the drafted follow-up email before sending.
    reviews: email
  - name: send
    type: action
    action: gmail.send_email
    input:
      to: '{{input.prospect_email}}'
      body_from_step: email
```

## 6 — Agent

Optional — wire this workflow into a named agent so your team can trigger it from chat.

```yaml
# context/<org>/agents/ziggy/agent.yaml
slug: ziggy
name: Ziggy
description: Sales agent — discovery, drafting, proposal generation
active: true
model: gpt-5.4
skillSlugs: [discovery_summary, draft_followup_email]
workflowSlugs: [discovery_followup]
```

## 7 — Apply + run

```bash
npm run context:apply          # reconcile YAML → DB, stamp a new context_version
npm run dev:next               # open /dashboard/chat
```

In chat, say:

> "start the discovery follow-up workflow on my last Acme call"

Ziggy picks the `discovery_followup` workflow. Step 1 runs `discovery_summary`. Step 2 runs `draft_followup_email`. Step 3 pauses at the approval gate — the draft lands in `/dashboard/review`. You approve, it sends.

## 8 — Audit

Head to `/dashboard/logs`. The workflow run is there, stamped with the active `context_sha`. Rate it 👍 or 👎 with a note. Any future prompt change is diffed against this run.

## 9 — Iterate

Notice the email was too formal. Edit `skills/draft-followup-email/prompt.md` directly in the dashboard (click **Edit** on the skill drilldown). Save — Vocion writes back to disk and reapplies. Run it again. Compare audit rows.

## What you just exercised

- Source authoring + retrieval override
- Object type definition + classification
- Prompt skill + typed input schema + evals
- Script sidecar (postprocess cleanup)
- Workflow composition: skills + approve gate + action
- Agent wiring
- Context apply loop
- Review queue
- Audit trail with rating + feedback
- In-app editing

Every one of these is a seam you can extend. Add more skills to Ziggy; add more steps to the workflow; add a second agent with a different wire-up. The shape stays the same.

## Related

- [Concepts](../concepts/) — read the five resources top-to-bottom
- [Authoring context](./authoring-context.md) — the edit-apply loop details
- [Evals](./evals.md) — gating prompt changes with fixtures
- [Feedback + logs](./feedback-and-logs.md) — closing the loop
