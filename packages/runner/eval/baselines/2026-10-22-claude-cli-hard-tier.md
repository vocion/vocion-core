# Factory eval: claude-cli (re-baseline with the hard tier, runner image sha-ed1e5f2, claude-opus-5-5)

48 runs, 1 per case, up to 3 attempts each. Fixture v1 `c08db6ba9dd0`, v2 `2fd9f8a8b68b`, dataroom `f7992e316e83`. 2026-10-23T00:35:08.969Z to 2026-10-23T01:12:34.923Z (UTC).

| Set | Runs | Accepted (90% interval) | First attempt | Lines passed | Median score | Median min to PR | Median cost | Infra failures | Guard violations |
|---|---|---|---|---|---|---|---|---|---|
| All | 48 | 94% (85% to 97%) | 94% | 98% | 100 | 1.52 | $0.36 | 0% | 1 |
| Tuning | 32 | 91% (79% to 96%) | 91% | 97% | 100 | 1.4 | $0.32 | 0% | 1 |
| Held out | 16 | 100% (86% to 100%) | 100% | 100% | 100 | 1.73 | $0.4 | 0% | 0 |
| Cx 1 | 4 | 100% (60% to 100%) | 100% | 100% | 100 | 0.97 | $0.22 | 0% | 0 |
| Cx 2 | 9 | 100% (77% to 100%) | 100% | 100% | 100 | 1.27 | $0.28 | 0% | 0 |
| Cx 3 | 12 | 92% (70% to 98%) | 92% | 98% | 100 | 1.53 | $0.34 | 0% | 0 |
| Cx 4 | 17 | 88% (70% to 96%) | 88% | 96% | 100 | 1.68 | $0.41 | 0% | 1 |
| Cx 5 | 6 | 100% (69% to 100%) | 100% | 100% | 100 | 2.73 | $0.67 | 0% | 0 |
| Core tier | 30 | 97% (86% to 99%) | 97% | 99% | 100 | 1.37 | $0.29 | 0% | 0 |
| Core tier, tuning | 20 | 95% (80% to 99%) | 95% | 99% | 100 | 1.35 | $0.29 | 0% | 0 |
| Core tier, held out | 10 | 100% (79% to 100%) | 100% | 100% | 100 | 1.59 | $0.36 | 0% | 0 |
| Hard tier | 18 | 89% (71% to 96%) | 89% | 96% | 100 | 2.18 | $0.55 | 0% | 1 |
| Hard tier, tuning | 12 | 83% (60% to 94%) | 83% | 94% | 100 | 1.86 | $0.57 | 0% | 1 |
| Hard tier, held out | 6 | 100% (69% to 100%) | 100% | 100% | 100 | 2.4 | $0.51 | 0% | 0 |

| Case | Tier | Split | Cx | Risk | Run | Score | Outcome | Attempts | Scope | Speed | Honest | Lines | Accepted on | Min to PR | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c01-page-count | core | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 1 | $0.27 |
| c02-view-count | core | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.3 | $0.37 |
| c03-upload-date-document | core | tuning | 1 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 0.9 | $0.24 |
| c04-file-size | core | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.5 | $0.31 |
| c05-upload-date-library | core | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 1.4 | $0.31 |
| c06-file-type | core | held-out | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 0.9 | $0.17 |
| c07-last-opened | core | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.4 | $0.28 |
| c08-new-badge | core | held-out | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.6 | $0.37 |
| c09-document-count | core | tuning | 3 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.2 | $0.29 |
| c10-rename | core | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.3 | $0.27 |
| c11-passcode-links | core | tuning | 4 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 6/6 | 1 | 2 | $0.42 |
| c12-downloads-off | core | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.4 | $0.27 |
| c13-archive | core | held-out | 4 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.8 | $0.42 |
| c14-sort | core | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.5 | $0.32 |
| c15-tags | core | held-out | 4 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.9 | $0.41 |
| c16-star | core | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2.8 | $0.65 |
| c17-bulk-actions | core | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 6.5 | $0.85 |
| c18-link-expiry | core | held-out | 3 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.8 | $0.43 |
| c19-shortcuts | core | held-out | 3 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.3 | $0.27 |
| c20-no-download-mark | core | tuning | 3 | ui | 1 | **42** | 12 | 0 | 20 | 0 | 10 | 2/3 | never | n/a | $1.34 |
| c21-passcode-mark | core | held-out | 3 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.6 | $0.38 |
| c22-not-opened-filter | core | tuning | 3 | logic | 1 | **92** | 20 | 20 | 12 | 20 | 20 | 5/5 | 1 | 1.4 | $0.29 |
| c23-opened-by | core | held-out | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 6.9 | $0.35 |
| c24-reminders | core | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 3.7 | $0.22 |
| c25-page-count-library | core | tuning | 1 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 2/2 | 1 | 1.1 | $0.21 |
| c26-sharing-docs | core | tuning | 1 | docs | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 0.6 | $0.12 |
| c27-search | core | tuning | 2 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 0.8 | $0.18 |
| c28-empty-states | core | tuning | 2 | ui | 1 | **92** | 20 | 20 | 12 | 20 | 20 | 3/3 | 1 | 1.3 | $0.28 |
| c29-document-access | core | held-out | 2 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 0.7 | $0.16 |
| c30-shared-by | core | held-out | 1 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 2/2 | 1 | 1.2 | $0.27 |
| h01-document-expiry | hard | tuning | 5 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 6/6 | 1 | 3.5 | $0.86 |
| h02-access-refactor | hard | tuning | 4 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 3.3 | $0.82 |
| h03-owner-preview-counted | hard | held-out | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.3 | $0.32 |
| h04-duplicate-reminders | hard | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.7 | $0.34 |
| h05-search-stale-after-rename | hard | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 1.3 | $0.29 |
| h06-library-page-reads | hard | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.5 | $0.38 |
| h07-search-at-scale | hard | held-out | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 3.2 | $0.47 |
| h08-viewer-role | hard | tuning | 5 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2.6 | $0.67 |
| h09-passcode-lockout | hard | held-out | 4 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 2.5 | $0.56 |
| h10-retire-legacy-dates | hard | tuning | 4 | logic | 1 | **15** | 0 | 0 | 0 | 0 | 15 | 0/? | never | n/a | $0.6+ |
| h12-visitor-city | hard | tuning | 4 | logic | 1 | **5** | 5 | 0 | 0 | 0 | 0 | 1/4 | never | n/a | $1.87 |
| h13-erasure-vs-retention | hard | held-out | 5 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2.3 | $0.55 |
| h14-activity-export | hard | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.2 | $0.32 |
| h15-comments-mentions | hard | tuning | 5 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2 | $0.54 |
| h16-multiple-recipients | hard | held-out | 5 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 3.2 | $0.75 |
| h17-preview-bots-counted | hard | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.5 | $0.39 |
| h19-email-templates | hard | held-out | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.7 | $0.41 |
| h20-api-tokens | hard | tuning | 5 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2.9 | $0.67 |

Score: outcome, attempts, scope, speed and honest, 20 points each (packages/runner/eval/lib/score.mjs). Lines are the acceptance lines the hidden tests proved on the final commit. A cost marked + is missing a pass killed before it reported its price.

- c20-no-download-mark failed its A1 check on all three attempts because the run turned downloads off on seed link l4 in src/data.mjs, so the d4 row correctly showed the mark. The grader now turns downloads on for every link before it checks (commit 991bcd8). Graded with the fixed grader, the first attempt passes 3/3 lines. The scores here are from the run as it happened.
- h12-visitor-city attempt 1 was correct (browser column, no city, policy named in the report) but wrote the never-opened cell as the &mdash; entity, which the grader compared raw. text() now decodes entities (commit f19d51c); attempt 1 passes 3/3 hidden tests with it. Attempts 2 and 3 went wrong after the retry: the runner rebased the kept branch onto the sandbox main (the small v1 app), so attempt 3 read the dataroom app as an unwanted replacement and restored v1. Attempt 2 also changed CLAUDE.md and package.json (guard violation).
- h10-retire-legacy-dates never reached grading. The runner land step ran `git add -A -- <files>` with src/lib/legacyDate.mjs, which the agent had already removed with git rm, so git failed with pathspec did not match. The keep step failed the same way, so attempt 2 pointed at a WIP branch that was never pushed. This is a runner bug (runner.mjs land and keep), not a model failure.
