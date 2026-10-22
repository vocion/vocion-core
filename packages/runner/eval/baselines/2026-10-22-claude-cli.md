# Factory eval: claude-cli (baseline, runner image sha-ed1e5f2, claude-opus-5-5)

30 runs, 1 per case, up to 3 attempts each. Fixture v1 `c08db6ba9dd0`, v2 `2fd9f8a8b68b`. 2026-10-22T23:17:49.000Z to 2026-10-22T23:54:42.489Z (UTC).

| Set | Runs | Accepted (90% interval) | First attempt | Lines passed | Median score | Median min to PR | Median cost | Infra failures | Guard violations |
|---|---|---|---|---|---|---|---|---|---|
| All | 30 | 97% (86% to 99%) | 93% | 98% | 100 | 1.33 | $0.3 | 0% | 0 |
| Tuning | 20 | 95% (80% to 99%) | 95% | 98% | 100 | 1.33 | $0.29 | 0% | 0 |
| Held out | 10 | 100% (79% to 100%) | 90% | 100% | 100 | 1.59 | $0.35 | 0% | 0 |
| Cx 1 | 4 | 100% (60% to 100%) | 100% | 100% | 100 | 0.96 | $0.25 | 0% | 0 |
| Cx 2 | 9 | 100% (77% to 100%) | 100% | 100% | 100 | 0.95 | $0.22 | 0% | 0 |
| Cx 3 | 12 | 92% (70% to 98%) | 92% | 96% | 100 | 1.82 | $0.4 | 0% | 0 |
| Cx 4 | 5 | 100% (65% to 100%) | 80% | 100% | 100 | 1.57 | $0.35 | 0% | 0 |

| Case | Split | Cx | Risk | Run | Score | Outcome | Attempts | Scope | Speed | Honest | Lines | Accepted on | Min to PR | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c01-page-count | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 0.8 | $0.19 |
| c02-view-count | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.4 | $0.34 |
| c03-upload-date-document | tuning | 1 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 1 | $0.22 |
| c04-file-size | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.2 | $0.23 |
| c05-upload-date-library | tuning | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 2 | $0.44 |
| c06-file-type | held-out | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 0.9 | $0.17 |
| c07-last-opened | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.3 | $0.27 |
| c08-new-badge | held-out | 2 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1 | $0.22 |
| c09-document-count | tuning | 3 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1 | $0.26 |
| c10-rename | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.4 | $0.33 |
| c11-passcode-links | tuning | 4 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 6/6 | 1 | 2.9 | $0.68 |
| c12-downloads-off | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.3 | $0.29 |
| c13-archive | held-out | 4 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.6 | $0.35 |
| c14-sort | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.8 | $0.4 |
| c15-tags | held-out | 4 | schema | 1 | **74** | 20 | 12 | 12 | 20 | 10 | 5/5 | 2 | 4.9 | $1.13 |
| c16-star | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.4 | $0.3 |
| c17-bulk-actions | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2.5 | $0.65 |
| c18-link-expiry | held-out | 3 | schema | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 2.2 | $0.48 |
| c19-shortcuts | held-out | 3 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.6 | $0.34 |
| c20-no-download-mark | tuning | 3 | ui | 1 | **25** | 5 | 0 | 20 | 0 | 0 | 1/3 | never | n/a | $1.49 |
| c21-passcode-mark | held-out | 3 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 7 | $0.5 |
| c22-not-opened-filter | tuning | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 5 | $0.49 |
| c23-opened-by | held-out | 3 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 1.8 | $0.4 |
| c24-reminders | tuning | 4 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 5/5 | 1 | 1.1 | $0.2 |
| c25-page-count-library | tuning | 1 | ui | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 2/2 | 1 | 1 | $0.28 |
| c26-sharing-docs | tuning | 1 | docs | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 0.4 | $0.1 |
| c27-search | tuning | 2 | logic | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 3/3 | 1 | 0.9 | $0.2 |
| c28-empty-states | tuning | 2 | ui | 1 | **92** | 20 | 20 | 12 | 20 | 20 | 3/3 | 1 | 1.3 | $0.25 |
| c29-document-access | held-out | 2 | auth | 1 | **100** | 20 | 20 | 20 | 20 | 20 | 4/4 | 1 | 0.9 | $0.16 |
| c30-shared-by | held-out | 1 | ui | 1 | **92** | 20 | 20 | 12 | 20 | 20 | 2/2 | 1 | 1.2 | $0.28 |

Score: outcome, attempts, scope, speed and honest, 20 points each (packages/runner/eval/lib/score.mjs). Lines are the acceptance lines the hidden tests proved on the final commit. A cost marked + is missing a pass killed before it reported its price.

- c20-no-download-mark was rerun from scratch after a grader fix: its A3 check matched the word checked inside the switch's onchange handler (box.checked), so a correct switch failed. The first run (1/3 lines after 3 attempts, $1.49) is kept on the box, not in this report.
- Runs went 3 at a time (--concurrency 3). Times are UTC.
