# Databricks as a data warehouse

A workspace connects a Databricks SQL warehouse and its agents can query it
live: one read-only `SELECT` at a time, over the schemas the source allows,
with row, size and time limits. Nothing is copied into Vocion — no sync, no
documents, no embeddings.

## What an agent can do

| Tool | What it does |
|---|---|
| `warehouse_schema` | With nothing: the allowed schemas, the dialect and the limits. With a schema: its tables and views. With a schema and a table: its columns and types. |
| `warehouse_query` | Runs one SQL query and returns the rows, the column types, whether the result was cut, and the statement id. |

The same two tools serve Snowflake, BigQuery and Redshift. There are **no
actions**: nothing writes to Databricks, ever.

## How read-only is enforced

Not by reading the SQL. Every query goes through the
[SQL Statement Execution API](https://docs.databricks.com/api/workspace/statementexecution)
in three steps, each the engine's own word:

1. **Plan as a subquery.** Vocion runs `EXPLAIN EXTENDED SELECT * FROM (<your query>)`.
   EXPLAIN plans without running, and Spark SQL's grammar accepts only a query
   inside `FROM (…)`, so DDL, DML or a second statement fail to parse and the
   query is refused. A plan Databricks could not analyse is refused too.
2. **Check what the plan reads.** The analysed plan names every table and view
   it reads, as `catalog.schema.table`. Any outside the allowed schemas — or a
   relation the guard cannot name, such as a file path — and the query is
   refused before it runs.
3. **Run it as written.** The API takes one statement only; `row_limit` and
   `byte_limit` cap the result on Databricks's side, and the statement is
   cancelled at the source's timeout.

Underneath is the token's owner: make it a user or service principal that can
only read.

## Connecting it

1. **Make a token** for a user or service principal with `CAN USE` on the SQL
   warehouse and `USE CATALOG`, `USE SCHEMA` and `SELECT` on the allowed
   schemas (Settings → Developer → Access tokens; see
   [personal access tokens](https://docs.databricks.com/en/dev-tools/auth/pat.html)).
2. **Paste the credential** at `/dashboard/connectors` → Databricks:

   | Field | What it is | Shown |
   |---|---|---|
   | Workspace URL | `https://dbc-1a2b3c4d-5e6f.cloud.databricks.com` | in full |
   | Personal access token | `dapi…` | masked |

3. **Settings on the source:**

   | Setting | What it does |
   |---|---|
   | SQL warehouse ID | Runs the queries; the last part of its HTTP path. |
   | Catalog | Where an allowed schema written without a catalog lives (`main`). |
   | Allowed schemas | The only schemas a query may read (`marts`, `finance.reporting`). Required. |
   | Most rows / kilobytes per query | Defaults 1000 rows and 2000 KB. |
   | Statement timeout | Default 60 seconds. |

**Test connection** reads the SQL warehouse, runs `SELECT 1`, and checks each
allowed schema is in the catalog's information schema. A stopped warehouse
starts, which Databricks bills. No OAuth app is needed.
