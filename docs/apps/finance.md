# Finance — the books coded, the month closed, the board told

**Finance** is a prebuilt app (id `finance`): a Controller and four seats who code expenses against the account rules, close the month, chase overdue invoices and prepare the statements, with every change to the books approved by a person.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/finance/app.yaml` |
| **Plugin** | `finance` (`packages/core/templates/plugins/finance/`): the Controller (lead), bookkeeper, account manager, financial analyst and payroll accountant; missions `set-up-finance`, `close-the-month`, `books-coded`, `statements-delivered`; the account rules and entities pages |
| **Reads** | the books through `services/finance/provider.ts` (`finance_list`, `finance_get`, `finance_report`) and the synced QuickBooks documents |

## Home

The app opens on its home (`/dashboard/apps/finance/home`; see [the app manifest](../entities/app-manifest.md#home--where-the-app-opens)).

- **Ask the Finance team…**: the words go to the Controller as a new chat.
- **Start something**: Set up Finance (the empty home's one tile), Close the month, Code expenses, Chase overdue invoices, Check project margins, Prepare the statements. Each asks the team in the words of its skills and starters.
- **Needs you**: the Finance seats' open decisions, decided in place.
- **Where things stand**, each figure dated:

| Figure | Read from | Dated by |
|---|---|---|
| This month's close | the newest `close-the-month` mission run: its state | when the run last moved |
| Waiting on your approval | proposals in Review for `finance.*` actions (recoded expenses, journal entries, invoices) | the oldest waiting |
| Cash in the bank | the `finance.account` state set: synced QuickBooks accounts of type Bank, balances added up | the QuickBooks sync |
| Overdue invoices | the core `overdue-invoices` view, balances added up, with the count | the QuickBooks sync |

A figure whose system is not connected, or never synced, is left out. Exceptions are not shown: the `reconcile` skill reports them in its output and nothing stores them yet, so there is nothing dated to count.

Finance records belong to the workspace, not to projects, so the home has no project blocks.
