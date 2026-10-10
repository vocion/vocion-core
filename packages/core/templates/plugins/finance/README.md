# Finance

A finance team for a workspace: five roles that keep the books coded, book
payroll, close the month, report to the board and watch project margins.
Every change to the ledger is proposed and waits for a person in Review.

```yaml
plugins: [finance]
```

| Role | Owns | Skills |
|---|---|---|
| Controller (lead) | The books and the close | finance-onboarding, period-close, accrual-schedule, journal-entry, controls-test |
| Bookkeeper | Day-to-day transactions | categorize-expense, reconcile, ap-run, ar-aging |
| Payroll Accountant | What people and contractors cost | payroll-entries, contractor-reconciliation, journal-entry, reconcile |
| Financial Analyst | What the numbers mean, and who receives them | statements, decompose-variance, board-pack, statement-distribution |
| Account Manager | Project profitability | project-profitability, decompose-variance |

**What the workspace brings.** Its own sources (a finance system, and
optionally an HR system, Gmail, Drive and Zoom), its evals, and who may open
it. Agents bind to sources by family (`requires:`), so the plugin names no
vendor: QuickBooks, NetSuite and Xero all serve.

**Setup.** Done when the finance system is connected and the Controller has
filed at least one legal entity and one account rule. Until then the chat
offers "Set up Finance" and the automations wait.

**Overriding.** Any file by slug: `agents/account-manager.yaml` with
`extends: core` patches the agent, a `skills/<slug>/SKILL.md` folder replaces
the skill. A workspace with a delivery system adds its own margin skill to the
Account Manager this way.

**Automations.** Month-end close (on), weekly expense coding (on), monthly
statements (off), quarterly board pack (off). Turn one on under
`pluginSettings.finance`.
