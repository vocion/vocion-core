# Factory eval

Phase 0 of the engine plan: the asks the factory walks were run on, turned into cases a machine can
score again and again, so a change of engine, model, prompt or runner is measured before it ships.
Today's engine, `claude-cli` (the runner image running headless Claude Code under the guard hooks),
is the baseline every later engine is compared with.

Each case is one ask as the engineering seat receives it: a task contract built exactly the way
factory dispatch builds one (`../contract/schema.json`, checked with the runner's own
`validateContract`), plus hidden acceptance tests the engine never sees and a reference change that
passes them. The hidden tests stand in for the QA seat: one test per acceptance line, run on the
commit the engine's pull request points at.

## Why it lives here

`packages/runner/eval` and not a new workspace:

- It drives the runner's contract and reuses its code directly (`src/contract.mjs`,
  `src/keep.mjs` for path globs, `src/usage.mjs` for cost), with no package boundary to cross.
- It is plain Node ESM with no dependencies, like the runner, and its tests run under the runner's
  existing `npm test` (now `node --test src/*.test.mjs eval/lib/*.test.mjs`), which CI's
  "Check the runner" job already runs. No new workspace, lockfile entries or CI changes.
- The runner image copies only `src/*.mjs`, so nothing here ships in the image.
- `packages/core/e2e` is Playwright against the product, a different kind of test.

## The fixture

The walks ran on a client product that now lives on Vocion Cloud, so no case runs against it.
Every case reproduces its walk's ask on `fixture/library-app`, a small document-sharing app (a
library of documents, share links, views) with the fictional Northwind cast and no dependencies.
`fixture/v2.patch` adds what the later walks built on (passcodes, download switches, archive, stars)
and is the starting point of the `v2` cases. The fixture's git history is fixed (author, dates), so
its commits are the same on every machine: v1 `f18eba20f97c`, v2 `0efe455fd860`. No case needs
DeliveryStack or a Vocion installation.

## Cases

30 cases: 20 to tune on, 10 held out. Tune prompts, settings and routing on the tuning split only;
the held-out split is read when an engine is judged, never while it is being tuned.

Complexity is the walk scale (1 a line of copy, 4 a feature with a schema or security edge). Every
complexity is in both splits. Risk classes: ui 14, logic 10, schema 3, auth 2, docs 1.
"walk" cases are the walk's ask as asked; "walk-adapted" changes a detail the fixture lacks;
"walk-derived" is a smaller ask drawn from what a walk found.

### Tuning (20)

| Case | Cx | Risk | Fixture | From walk | Lines | Ask |
|---|---|---|---|---|---|---|
| `c01-page-count` | 2 | ui | v1 | 1 (walk) | 3 | Show how many pages the document has |
| `c02-view-count` | 2 | ui | v1 | 2 (walk) | 4 | Show how many times the document has been viewed |
| `c03-upload-date-document` | 1 | ui | v1 | 3 (walk) | 3 | Show when the document was uploaded, under its title |
| `c04-file-size` | 2 | ui | v1 | 8 (walk-adapted) | 4 | Show the file size next to the page count |
| `c05-upload-date-library` | 2 | ui | v1 | 9 (walk) | 3 | Show the upload date under each title on the library list |
| `c07-last-opened` | 3 | logic | v1 | 11 (walk) | 5 | Show when each document was last opened on the library list |
| `c09-document-count` | 3 | ui | v1 | 13 (walk) | 4 | Show how many documents are in the library at the top of the list |
| `c10-rename` | 3 | logic | v1 | 14 (walk) | 5 | Let the owner rename a document |
| `c11-passcode-links` | 4 | auth | v1 | 15 (walk) | 6 | Passcode-protected share links |
| `c12-downloads-off` | 4 | logic | v1 | 16 (walk) | 5 | Turn off downloads for a share link |
| `c14-sort` | 3 | logic | v1 | 18 (walk-adapted) | 5 | Sort the library by name, upload date or last opened, and remember the choice |
| `c16-star` | 3 | logic | v1 | 20 (walk) | 5 | Star documents and keep them at the top of the library |
| `c17-bulk-actions` | 3 | logic | v2 | 21 (walk) | 5 | Select several documents and act on them at once |
| `c20-no-download-mark` | 3 | ui | v2 | 24 (walk) | 3 | A "No download" mark, and the switch beside each link |
| `c22-not-opened-filter` | 3 | logic | v1 | 26 (walk) | 5 | A "Not opened yet" filter on the library |
| `c24-reminders` | 4 | logic | v1 | 5 (walk-adapted) | 5 | Remind recipients who have not opened |
| `c25-page-count-library` | 1 | ui | v1 | 1 (walk-derived) | 2 | Show the page count on each library row |
| `c26-sharing-docs` | 1 | docs | v1 | 22 (walk-derived) | 4 | Write the sharing guide |
| `c27-search` | 2 | logic | v1 | 13 (walk-derived) | 3 | Search ignores case, extra spaces and word order, and matches whole words from their start |
| `c28-empty-states` | 2 | ui | v1 | 26 (walk-derived) | 3 | Friendly empty states on the library |

### Held out (10)

| Case | Cx | Risk | Fixture | From walk | Lines | Ask |
|---|---|---|---|---|---|---|
| `c06-file-type` | 2 | ui | v1 | 10 (walk-adapted) | 3 | Show the file type next to the page count |
| `c08-new-badge` | 2 | ui | v1 | 12 (walk) | 4 | A New badge on documents uploaded in the last 24 hours |
| `c13-archive` | 4 | schema | v1 | 17 (walk) | 5 | Archive a document |
| `c15-tags` | 4 | schema | v1 | 19 (walk) | 5 | Tag documents and filter the library by tag |
| `c18-link-expiry` | 3 | schema | v1 | 22 (walk) | 5 | Link expiry controls |
| `c19-shortcuts` | 3 | ui | v1 | 23 (walk) | 5 | Keyboard shortcuts in the library |
| `c21-passcode-mark` | 3 | ui | v2 | 25 (walk) | 4 | A passcode switch beside access, with a Passcode mark, and members never asked |
| `c23-opened-by` | 3 | logic | v1 | 27 (walk) | 4 | "Opened by N" on each library row |
| `c29-document-access` | 2 | auth | v1 | 13 (walk-derived) | 4 | A document in another library is not reachable by id |
| `c30-shared-by` | 1 | ui | v1 | 17 (walk-derived) | 2 | Say who shared the document on the visitor page |

Each case directory holds `case.json` (the ask, its acceptance lines, the paths it may touch and
the approved plan summary), `grader.test.mjs` (the hidden tests, titled `A1:` to `An:`, one per
acceptance line) and `reference.patch`.

## The score

The walk rubric (outcome, hands-off, chat on your word, speed, honest status, 20 points each)
read through an engine run, where there is no person and no chat. The exact steps are in
`lib/score.mjs`.

| Points | Walk criterion | Here |
|---|---|---|
| Outcome | Outcome | The acceptance lines the hidden tests prove on the final commit |
| Attempts | Hands-off | Which attempt QA accepted: first 20, second 12, third 5 |
| Scope | Chat on your word | Inside the contract: no person-owned file, the suite kept whole, no files beyond the plan |
| Speed | Speed | Dispatch to the accepted pull request over all attempts: 20 min 20, 45 min 12, 2 h 5 |
| Honest | Honest status | What the run reported against what the tests found, worst attempt |

An attempt the hidden tests do not fully pass is sent back the way QA sends work back: the next
attempt's contract carries notes naming the lines that failed and resumes from the kept branch,
up to three attempts. The report gives, overall, per split and per complexity: accepted rate with a
90% interval, first-attempt rate, lines passed, median score, median minutes to pull request,
median and total cost (from the runner's `claude.finished` lines), infrastructure failures and
guard violations. The live check is not part of a fixture run and is recorded as absent.

## Running it

```sh
node packages/runner/eval/run.mjs list              # the cases and the split
node packages/runner/eval/run.mjs check             # every contract accepted; hidden tests fail on the fixture, pass on the reference
node packages/runner/eval/run.mjs dry-run           # oracle and noop runs plus the claude-cli preflight, no model
node packages/runner/eval/run.mjs run \
  --engine claude-cli --split tuning --runs 2 \
  --runner-image ghcr.io/vocion/vocion-runner:sha-<core sha> \
  --fixture-repo https://github.com/<org>/<sandbox repo>.git
```

`run` writes `results/<time>-<engine>/<engine>.json` and `.md` (the scoreboard), plus each
attempt's runner log. Flags: `--split tuning|held-out|all`, `--cases c07,c13`, `--runs`,
`--max-attempts` (3), `--model` (the engineering seat's pin, `claude-opus-5-5`), `--effort`, `--out`.

Engines: `claude-cli` (the baseline), `oracle` (applies the reference change) and `noop` (changes
nothing), the last two to prove the harness. `openhands`, `codex` and `claude-sdk` are named and
refuse to run until they are built (Phases 3 and 4).

### What a claude-cli run needs

`run` checks these first and lists what is missing instead of starting:

- **Docker and the runner image** (`--runner-image` or `EVAL_RUNNER_IMAGE`). The guard hooks are
  wired to `/opt/vocion-runner/hooks` in `claude-settings.json`, so the runner only runs in its image.
- **`ANTHROPIC_API_KEY`**. The runner removes AWS credentials from the engineer's environment, so
  the baseline reaches the model with an Anthropic key, not Bedrock.
- **`GITHUB_TOKEN`** that can push branches and open pull requests on the sandbox repository.
- **A sandbox GitHub repository** (`--fixture-repo` or `EVAL_FIXTURE_REPO`, an https URL; the
  contract accepts nothing else). The eval pushes the fixture to its `main` and `eval-fixture-v2`
  (never forcing), the runner opens its pull requests there, and the eval fetches each commit back
  to grade it. Use a repository nothing else depends on.

Budget: the runner's cost cap per attempt is $3 to $12 by complexity (`lib/cases.mjs`), so one
pass over all 30 cases is at most about $610 with every retry, far less in practice.

## Changing a case

Keep the hidden tests honest: `run.mjs check` must stay clean (every hidden test file fails
somewhere on its starting fixture and passes in full on the reference, and the fixture's own suite
still passes). Never move a held-out case into tuning after an engine has been tuned against it;
add a new case instead.
