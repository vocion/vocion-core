---
slug: naming-the-work
name: Naming the work
description: >-
  The five names one piece of work carries and the different job each one
  does: the request title in the asker's words, the task title naming the
  change literally in the imperative, the commit subject in Conventional
  Commits form, the pull request title repeating the task title, and the
  release note saying what a customer can now do. A title that describes the
  situation instead of naming the change fails review. Attached to contract
  writing, planning, execution and release notes.
version: 1
---

# Naming the work

One piece of work is named five times on its way through the factory, and each
name has a different reader. Conflating them is the common bug. A title that
reads "Ship the email wordmark the invite email already points at" describes
the *situation* the author found; it never says what will be different
afterwards. A stranger reading it cannot tell whether we are adding an image,
changing an email, or removing a link.

The five names, and who reads each one:

| name | written by | read by | job |
|---|---|---|---|
| request title | the asker | everyone, forever | evidence of what a person wanted |
| outcome line | triage | anyone deciding, on every surface | what a person can do afterwards |
| task title | the planner | the reviewer, the merger, the person scanning the backlog | the change, literally |
| commit subject | the engineer | `git log`, for years | the change, in the repository's vocabulary |
| pull request title | the engineer | the reviewer and the merge queue | the change, again, unchanged |
| release note | the product manager | a customer | what they can now do |

## 1. Request title: the ask, in the asker's words

**Never rewritten.** The `request` record's title is what a person typed, or
the subject line they sent, or the first sentence of the store review. It is
evidence, and evidence that has been tidied is no longer evidence: once it is
paraphrased, nobody can tell whether two requests are the same complaint or
whether the planner invented the need.

Tag it, dedupe it, rank it, link it — do not edit it. If it is unreadable,
that is a fact about the request worth knowing. Clarity is added in the body
and in `requestSummary`, never by overwriting the title.

## 1b. Outcome line: what every surface leads with

The request title is evidence and must not be rewritten. That leaves a gap
nobody filled for a long time: **no line on the record states the change**, so
every surface led with the ask — which is a situation, not an outcome.

`request.outcome` closes it. One sentence, written at triage, to exactly the
task-title rules below: a verb first, the user-visible outcome, no paths or
modules, one change. The work item page, the queue and the review card all
lead with it and keep the asker's words as evidence underneath.

> Asked: *"add send/share to file detail page"*
> Outcome: **Allow users to send files to email recipients.**

The second is the one worth approving. It names a capability rather than a
control, it says what is different afterwards, and a person who has never
seen the product can read it. The first names a button and a screen — and on
this very request it also hid the fact that sharing already existed, because
a control can be "added" to a page that already has one.

## 2. Task title: the change, literally, in the imperative

The task title is the one that keeps going wrong. It is not a summary of the
situation, not the mechanism, not a joke, and not a headline. It is **the
change**, in the imperative, naming the user-visible outcome and where it
happens:

> Allow a person to send a document by email from the document page.

### The stranger test

Could a stranger read this title and tell you what will be different
afterwards? If the honest answer is "I would have to open it", the title
fails, and a reviewer returns it.

Two supporting tests, both borrowed from commit-message practice:

- **The imperative test** (Chris Beams): "If applied, this task will ___"
  must read as a grammatical sentence. "If applied, this task will *ship the
  email wordmark the invite email already points at*" does not, because
  "ship" here is doing no work.
- **The completion test** (Atlassian Community): "To complete this ticket, I
  need to ___" must name an action, not a condition.

### The rules

1. **Start with a verb in the imperative.** Allow, show, send, remove,
   rename, refuse, record. Not "Fix for…", not "Wordmark work", not a noun
   phrase.
2. **Name the user-visible outcome, and where.** Who can now do what, on
   which screen, in which email, at which endpoint. Where there is no
   user-visible outcome — an internal refactor, a smoke test — say that
   plainly instead of dressing it up.
3. **No file paths, frameworks or internal modules** unless the change is
   genuinely about that thing. "in `apps/send-web`" is not where the user is;
   "on the document page" is. A migration of the notify service to a new
   template engine *is* about the module, and names it.
4. **No situation reports.** "The invite email points at a missing image" is
   the problem statement; it belongs in the objective. The title says
   "Show the product wordmark in every product email instead of a broken
   image."
5. **One sentence, one change.** If the title needs "and" twice, the task
   needs splitting.
6. **Say when it is a test.** A deliberate smoke test is titled
   `Smoke test: <what it exercises>`. A run that exists to make a check fail
   is valuable, and hiding that behind product-sounding language wastes a
   reviewer's afternoon.
7. **Keep the attempt suffix.** Where several task records share one
   `taskId`, the title ends `(attempt N)` so the rows are distinguishable in
   a list.
8. **Aim for 70 characters; 100 is the ceiling.** Lists truncate. A title
   that does not fit was trying to be an objective.

### Good and bad, from our own backlog

| before | after | what was wrong |
|---|---|---|
| Ship the email wordmark the invite email already points at | Show the product wordmark in every product email instead of a broken image | describes the situation; "ship" names no outcome |
| Add a single Share action to the document page in apps/send-web | Allow a person to email a document link to recipients from the document page | names a repository path, not the outcome |
| Write docs/FACTORY-FIRST-RUN | Document how a factory worker claims a run, verifies it and opens a pull request | names the file, not what the reader learns |
| Make no code change | Smoke test: count the test files with a Postgres sidecar running and change nothing | names the absence of a change, not what is exercised |
| Verification of the contract validator: this contract uses camelCase keys on purpose and m… | Smoke test: refuse a task contract with camelCase keys before cloning | a noun phrase, then the objective pasted in and truncated |
| Instrument Send for observability with two tools, each doing what it is best at, and nothi… | Report Send's behaviour to PostHog and its errors to Sentry, with nothing counted twice | an essay; truncation ate the point |
| Filter e2e-suite submissions at intake and tag them test | Keep e2e-suite submissions off the backlog by tagging them test at intake | mechanism only; the outcome is an uncluttered backlog |

The last row is the subtle one. "Filter … and tag them test" is imperative and
specific and still not a good title, because it names what the code does
rather than what anybody gets. Prefer the outcome; keep the mechanism if it
fits.

## 3. Commit subject: Conventional Commits, imperative, no period

The commit subject follows the **Conventional Commits 1.0.0** specification:

```
<type>[optional scope]: <description>
```

- **Type** is a noun from `feat`, `fix`, `docs`, `refactor`, `test`, `build`,
  `ci`, `chore`, `perf`, `style`, `revert`. `feat` and `fix` are the two the
  specification requires; the rest are conventional. A breaking change takes
  `!` before the colon, or a `BREAKING CHANGE:` footer, or both.
- **Scope** is optional and is the part of the codebase, in the repository's
  own vocabulary: `feat(invites):`, `fix(notify):`.
- **Description** is imperative, lower case after the colon, **no trailing
  period** — a period costs a character and adds nothing.
- The **body** is separated by one blank line, wrapped at 72 columns, and
  explains **why**, not what. The diff already says what. Footers follow a
  blank line.

### On length, where the sources disagree

Chris Beams says **50 characters** for the subject, on the grounds that GitHub
truncates at 72 and that the constraint forces the author to think. The Linux
kernel's submitting-patches guidance says the summary phrase must be **no more
than 70 to 75 characters** and must describe both what the patch changes and
why it might be necessary. They are arguing about different things: Beams is
writing for application repositories where the scope is implicit, the kernel
is writing for a mailing list where the summary is a globally unique
identifier.

**Our rule: the whole subject line, prefix included, fits in 72 characters.
Aim for 50.** The conventional prefix eats ten to twenty of them, so 50 is a
target rather than a limit, and 72 is the line beyond which tools start
cutting. Where a repository's own convention allows more, it says so in its
`CLAUDE.md` and that wins.

## 4. Pull request title: the same sentence, with the prefix

The pull request **is** the change, so its title is the task title with the
conventional prefix in front of it, and nothing else invented:

```
feat(share): allow a person to email a document link from the document page
```

It is not a fresh summary, not the objective truncated at sixty-four
characters, and not the branch name prettified. When the factory's worker
opens a pull request it derives the title from the task's `title` field for
exactly this reason; where the task carries no title the worker falls back to
the first sentence of the objective, and that fallback is a defect in the
contract, not a feature.

The run or task identifier stays as a suffix — `(send-0009-share-link)` — so a
pull request can be traced back to the contract that authorized it.

## 5. Release note: what a customer can now do

The release note is written for somebody who has never seen the backlog. It
names the capability, in the house voice, in the customer's vocabulary:

> You can now email a document straight from its page, to as many people as
> you like, with a short note.

No internal nouns: no task ids, no repository names, no module names, no risk
classes, no model names, no "refactored", no "wired up". If the change is not
visible to a customer, it does not get a release note; it gets a line in the
changelog and nothing more. Atlassian's user-story guidance is the right
register here — a user story is written "from the end user's or customer's
perspective" in "non-technical language", and a release note is the same
sentence after the fact.

## In practice

- The planner writes the task `title` at the same time as the `objective`,
  and reads it back with the stranger test before dispatching. A contract
  whose title restates the situation is not dispatched.
- The reviewer rejects a task title that fails the stranger test, the same
  way it rejects an acceptance criterion that no command can check. It is
  cheap to fix before the work and expensive after.
- The worker's commit subject and pull request title are derived from the
  task title, so a good title is written once and reused three times.
- When an old title is corrected, the previous one is recorded on the record
  (`meta.titleBefore`) with the reason for the change. Nothing is lost, and
  the correction is auditable.

## Sources

- Conventional Commits 1.0.0 — https://www.conventionalcommits.org/en/v1.0.0/
- Chris Beams, "How to Write a Git Commit Message" —
  https://chris.beams.io/posts/git-commit/ (now served at https://cbea.ms/git-commit/)
- Linux kernel, "Submitting patches: the essential guide to getting your code
  into the kernel" —
  https://www.kernel.org/doc/html/latest/process/submitting-patches.html
- Atlassian, "User Stories with Examples and a Template" —
  https://www.atlassian.com/agile/project-management/user-stories
- Atlassian Community, "How to write a useful Jira ticket" —
  https://community.atlassian.com/forums/Jira-articles/How-to-write-a-useful-Jira-ticket/ba-p/2147004
