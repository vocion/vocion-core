# Voice rules

How a workspace stops an agent sending a draft in a voice its owner hates —
structurally, not by asking the model more nicely.

## Why this is code and not a prompt

The voice used to live entirely in prompt text: a playbook describing how the
sender writes, cited by every drafting skill. Nothing checked the output.

That fails in a specific and repeatable way. "Conversational, direct, low
pressure, no pitch" is an instruction a model satisfies by *performing* the
register instead of writing in it — which is exactly where `Curious about…`,
`No pitch, just…` and `Quick question` come from. The guide's own words
produce the tells it is trying to prevent, and because nothing reads the
output, the first person to notice is the one whose name is on the send.

So the rules are data, the check is code, and the prompt is the last lever
rather than the only one:

| Layer | What it is | What happens on a violation |
|---|---|---|
| Platform floor | `libs/writing/voiceRules.ts` | Blocks. Always on. |
| Workspace rules | `workspace/<org>/voice.yaml` | Blocks. |
| Voice playbook | any workspace playbook, named in `voice.yaml` | Prose only — steers, never blocks. |

## The rule set

`VoiceRules` (`packages/core/src/libs/writing/voiceRules.ts`):

```ts
type VoiceRules = {
  never: Array<{ id?: string; pattern: string | RegExp; reason: string }>;
  prefer?: Array<{ pattern: string | RegExp; use: string; reason?: string }>;
  allow?: string[]; // platform-default rule ids this workspace opts out of
  maxWordsPerSend?: number;
  maxAsksPerSend?: number;
  noExclamation?: boolean;
  noEmoji?: boolean;
  noEmDash?: boolean;
};
```

`lintCopy(text, rules)` is pure and synchronous and returns
`{ ok, violations[] }`. Each violation names the offending span, its character
offset, the authored reason, and whether it blocks. Matching is
case-insensitive, word-boundary aware (`just curious` does not fire inside
`adjust curiousness`), whitespace-flexible across a line wrap, and agnostic
about which apostrophe the model used.

`prefer` entries are reported and never block — they are a steer, and a steer
that blocks is a `never` wearing a disguise.

## What ships in the platform floor

Core's default list is deliberately small and deliberately *not* anyone's
taste. The bar for an entry is that it is a register problem in any business
outbound, for any sender, in any workspace. Three families:

1. **Filler openers** — `I hope this finds you well`, `just checking in`,
   `circling back`, `touching base`, `I wanted to reach out`, `I noticed
   that`, `I came across`, `in today's fast-paced`. No information; the
   signature of a note written to a list.
2. **Register announcements** — `no pitch`, `not a pitch`, `not selling
   anything`, `just curious`, `curious about/if/whether/how`, `quick
   question`, `does that make sense`, `thoughts?`, `hope this helps`. A line
   that tells the reader what kind of message this is instead of being that
   kind of message. This is the family the complaint was about.
3. **Hedged non-offers and assistant vocabulary** — `would love to`, `I'd
   love to`, `happy to`, `feel free to`, `let me know if`, `great question`,
   a standalone `Absolutely.`, `delve`, `leverage`, `unlock`, `supercharge`,
   `game-changer`.

Plus `noEmoji: true`.

What is **not** on the floor, on purpose: `noExclamation`, `noEmDash`, and any
word/ask ceiling. All three appear in real founder correspondence, so banning
them platform-wide would be taste dressed as hygiene. They belong in
`voice.yaml`.

Every default rule carries an `id`, so a workspace that genuinely writes one
of these (a private-equity firm and `leverage`, say) can opt out by naming it:

```yaml
allow: [leverage]
```

The floor is a default, not a cage — but the exemption is versioned in the
same file as everything else, so it shows up in a diff.

## Authoring `voice.yaml`

One file at the workspace root, beside `trust.yaml`:

```yaml
# workspace/<org>/voice.yaml
never:
  - pattern: Quick one
    reason: Register announcement. Nothing is made shorter by calling it quick.
  - pattern: 'saw you (grabbed|downloaded|picked up)'
    match: regex
    reason: Names the tracked behaviour back at the reader.

prefer:
  - pattern: utilize
    use: use

allow: []
maxWordsPerSend: 120
maxAsksPerSend: 1
noExclamation: true

# The playbook that describes this voice positively. Composed into the
# rewrite prompt. Core never hardcodes a slug.
playbook: founder-voice

# The learnings step reviewer edit-diffs land in as proposed rules.
# Unset means edit-diffs are not mined.
learningStep: voice
```

`match` defaults to `phrase`. `reason` is required — an unexplained ban is not
reviewable, and the reason is what the model is told on the retry.

`npm run workspace:check -- <path>` validates it and prints the counts;
`workspace:apply` lands it on `project.voice_rules` (migration 0108). Deleting
the file clears the column and the workspace drops back to the floor.

## Where the gate sits

**1. The skill seam.** `outboundCopy(rules, label)` is a zod string that
raises an issue per blocking violation. Any skill output schema can wrap its
`subject`/`body` fields in it. `runSkillTurn` already validates the model's
answer with the caller's schema and, on failure, retries with the validation
error quoted back — so the model is told *"body: "Curious about" is banned —
Announces the register instead of being it. Ask the question directly."* and
gets one corrective attempt.

Set `maxAnswerRetries: 1` on a schema that encodes judgement rather than
shape. A model that repeats a banned phrase after being told the phrase and
the reason will not find it on the fourth attempt, and burning the turn budget
to fail anyway is just a slower failure. It then throws `SkillTurnError`:
**loudly**, because a draft that still carries the phrase must never reach a
queue.

Applied today at `libs/actions/personalization-enroll.ts`
(`regenerateTurnOutputFor`), the repo's only production `runSkillTurn` caller
that produces prospect-facing copy.

**2. The proposal seam.** A gate that only covers the model call has a
corridor around it: the hourly drafting pass proposes through
`saveDraftSequence`, the write API proposes directly, a replay re-proposes
stored input. So `personalization.enroll` has a `precheck` that runs inside
`proposeAction` — after schema validation, before any write — and lints every
send with `lintSends`. The refusal names every span and reason and nothing is
persisted.

**3. The rewrite seam.** `ReviewService.rewriteDraft` (the queue's "Add
change" / Regenerate copy path) used to build its own prompt from one
hardcoded sentence of generic house style and validate nothing, which meant
every rewrite silently discarded the workspace's voice guide. It now composes
the rules plus the named playbook's body into the system prompt, lints the
answer with the same rules, retries once naming the offending phrases, and on
a second failure **returns the original with `voiceError` set** rather than
handing back tell-laden copy. No revision row is written for a rewrite that
failed the gate.

## How edits become rules

The founder-voice playbook said "treat queue edit-diffs as corrections to this
guide". Nothing did — the only thing an edit recorded was the boolean fact
that one happened, because `updateActionInput` replaces the proposal wholesale
and the agent's words are gone.

Now, at the one moment both versions exist (`ReviewService.decide`, before
`updateActionInput`), `services/feedback/voiceLearning.ts` word-diffs the
proposed copy against the approved copy and proposes each **deleted phrase**
as a new `never` rule through the existing `ruleRecorder`. Because
`ruleRecorder` already merges duplicates and counts occurrences, the third
time the same phrase is cut, the candidate says so in one number.

Conservative on purpose — a bad candidate costs a person's attention:

- runs of 2–8 words only;
- nothing containing a digit, URL or `@` (that is a fact being corrected);
- nothing containing a non-sentence-initial capital (almost always a name,
  company or product — and filing one as a rule would leak it as well as be
  wrong);
- nothing the rules already flag (the gate owns that, not the learner);
- at most three candidates per decision.

Opt-in: a workspace names the step as `learningStep:` in `voice.yaml`. Without
it nothing is recorded, because a voice rule filed into an unrelated step is
worse than no rule.

**Nothing is auto-adopted.** A candidate sits pending in
`/dashboard/learnings` until a person accepts it. That is the manifesto's gate
and also the honest position: a deletion is evidence, not a verdict — a
reviewer trimming for length looks identical in the diff to one deleting a
tell, and only a person can tell them apart.

Rewrite hints and rejection notes already reached the learning queue through
`recordActionSignal` → `queueSignalForLearning`; the edit diff is the signal
that was missing.

## Testing

- `src/libs/writing/voiceRules.test.ts` — matching, merging, the gate, and
  the offending send vs. the founder-voice calibration examples.
- `src/libs/workspace/voice.test.ts` — `voice.yaml` loading and the stored →
  runtime conversion.
- `src/services/feedback/voiceLearning.test.ts` — the edit diff and its
  filters.
- `src/services/ReviewService.rewriteVoice.test.ts` — the rewrite gate.
- `src/libs/actions/personalization-enroll.test.ts` — the proposal gate.
- `src/services/agents/skillTurn.test.ts` — the retry budget.
