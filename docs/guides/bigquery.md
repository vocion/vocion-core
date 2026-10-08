# BigQuery as a warehouse source

A workspace connects BigQuery once, lists the datasets an agent may read, and
every agent given the source can answer from it live with two tools:

- `warehouse_schema` — the allowed datasets, the tables in one, a table's
  columns (nested RECORD fields listed as `parent.child`).
- `warehouse_query` — one GoogleSQL `SELECT`, rows back.

Nothing is synced or copied into Vocion, and there are **no actions**:
BigQuery is read here and never written.

## How read-only is enforced

Not by reading the SQL. Every statement is first **dry-run**
(`jobs.insert` with `dryRun: true` — plans it, runs nothing, bills nothing),
and BigQuery's own answer decides:

- `statementType` must be `SELECT`. DML, DDL, DCL and multi-statement scripts
  are refused, naming the type.
- `referencedTables` must all be in an allowed dataset. A dry run listing 50
  or more tables (where BigQuery may stop listing), or reading bytes while
  naming no table, is refused rather than guessed at.
- `totalBytesProcessed` must be under the source's cap.

The query then runs with `jobs.query` on a token minted with the
**`bigquery.readonly`** scope and `maximumBytesBilled` set, so BigQuery itself
refuses a write or an overspend. (The dry run and a timeout's job cancel use
the `bigquery` scope, because `jobs.insert` and `jobs.cancel` accept no
read-only scope; neither touches data.) A job still running at the source's
timeout is cancelled.

## Connecting it

1. Make a service account with **BigQuery Data Viewer** on each allowed
   dataset and **BigQuery Job User** on the project that runs (and pays for)
   the queries — nothing that writes.
2. Create a JSON key and paste three values from it on the Connectors page:

   | Field | From the key file | Shown |
   |---|---|---|
   | Project ID | `project_id` | in full |
   | Service account email | `client_email` | in full |
   | Private key | `private_key` (literal `\n` is fine) | masked |

3. Settings on the source:

   | Setting | Default | |
   |---|---|---|
   | Allowed datasets | — (required) | `marts` (in the key's project) or `other-project.finance` |
   | Location | BigQuery decides | `US`, `EU`, `us-central1` |
   | Most gigabytes billed per query | 10 | refused at dry run, and enforced by BigQuery |
   | Most rows / kilobytes per query | 1000 / 2000 | the rest is not read back |
   | Statement timeout | 60 s | the job is cancelled |

**Test connection** dry-runs `SELECT 1` (proving the key and Job User) and
looks up each allowed dataset. Free; nothing is saved.

Values come back JSON-safe: an INT64 past 2^53 or a NUMERIC with more digits
than a double holds stays a string, TIMESTAMP is ISO 8601, RECORD is an
object and REPEATED an array.

Auth is a service account only — no OAuth app or env var to register.
