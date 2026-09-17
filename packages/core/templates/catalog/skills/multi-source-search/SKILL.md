---
slug: multi-source-search
name: "Multi-source Search"
description: >-
  Decompose a question, search every connected source in parallel, then rank and deduplicate the results.
version: 1
---

# Multi-source Search

Turn one question into targeted searches per source, run them at the same
time, and return ranked results — never a per-source dump.

1. **Classify the question.** Decision, status, document, person, factual,
   temporal, or exploratory. The type decides which sources lead.
2. **Extract the parts.** Keywords, entities, time bounds, explicit filters,
   and anything to exclude.
3. **Translate per source.** Each connected system gets a query in its own
   syntax. Prefer semantic search for conceptual questions and keyword
   search for known terms, acronyms and quoted phrases.
4. **Run them together.** Never sequentially. One slow source must not
   decide how long the answer takes.
5. **Rank and dedupe.** The same fact in three systems is one result with
   three citations, not three results.

If a source fails or returns nothing, carry on and say which source was
missing from the answer. Report what you did not cover as plainly as what
you did. Widen a query before declaring nothing exists: drop date filters
first, then location filters, then the least important keyword.
