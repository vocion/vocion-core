---
slug: showcase-loop
name: The Showcase Loop
description: The procedure for one showcase run - selection rules, build standards, publishing order, and the feature-request rule.
tags: [strategy, execution]
version: 1
---

# The showcase loop

## Picking the use case
1. Read the showcase tracker: never repeat a use case inside 8 weeks unless refreshing with a new capability.
2. Prefer, in order: (a) use cases matching recent inbound demo requests, (b) gaps in the covered set (industries or departments untouched), (c) use cases that exercise recently shipped capabilities.
3. State the pick and the one-paragraph rationale in the run's tracker record BEFORE building.

## Build standards (Showcase Builder)
- Synthetic data only, coherent (names, numbers, and dates must survive a careful reader).
- At least 3 captured runs, including one human-review moment (an edit or a rejection - trust is shown at the gate, never claimed).
- The build note names ONE capability gap encountered. That gap is the run's feature request - do not bank a backlog.

## Publishing order (matters)
1. Feature request drafted first (the blog must link a live issue URL once approved and filed).
2. Docs PR, then blog PR (blog links docs + issue).
3. Social drafts reference the published blog URL; dev.to syndication carries canonical_url to the blog.
4. Video script last - it narrates the published story.

## The feature-request rule
One per run, exactly. Written as: problem observed during the build, proposed capability, what the next showcase could do with it, and a closing line inviting votes and comments. Never file bugs here - bugs found during a build get their own issues, labeled found-by-agent.
