# Snowflake as a data warehouse

A workspace connects a Snowflake account and its agents can query it live:
one read-only `SELECT` at a time, over the schemas the source allows, with
row, size and time limits. Nothing is copied into Vocion — no sync, no
documents, no embeddings.

## What an agent can do

| Tool | What it does |
|---|---|
| `warehouse_schema` | With nothing: the allowed schemas, the SQL dialect and the limits. With a schema: its tables and views (row counts and comments). With a schema and a table: its columns and types. |
| `warehouse_query` | Runs one SQL query and returns the rows, the column types, whether the result was cut, and Snowflake's query id. |

Both tools are the warehouse family's, the same on BigQuery, Databricks and
Redshift; the source the agent was given decides which warehouse answers.
There are **no actions**: nothing writes to Snowflake, ever.

## How read-only is enforced

Not by reading the SQL. Every query goes through three steps, each Snowflake's
own word:

1. **Compile as a subquery.** Vocion runs `EXPLAIN USING JSON SELECT * FROM (<your query>)`.
   EXPLAIN compiles without running, and Snowflake's grammar accepts only a
   query inside `FROM (…)`, so `INSERT`, `DELETE`, `CREATE`, `GRANT`, `CALL`
   or a second statement fail to compile and the query is refused.
2. **Check what the plan reads.** Every scan in the plan names the table it
   reads (`DATABASE.SCHEMA.TABLE`). Any outside the allowed schemas, or a scan
   that names nothing, and the query is refused before it runs.
3. **Run it as written**, with `MULTI_STATEMENT_COUNT=1`, the source's
   timeout (Snowflake cancels the statement past it) and
   `ROWS_PER_RESULTSET` one past the row cap.

Underneath all three is the role: give the user one that can only read.

## Connecting it

1. **Make a key-pair user** (Snowflake's [key-pair auth](https://docs.snowflake.com/en/user-guide/key-pair-auth)):
   generate an RSA key, then `ALTER USER vocion_reader SET RSA_PUBLIC_KEY='…'`.
   Give it a default role with `USAGE` on the warehouse, the database and each
   allowed schema, and `SELECT` on their tables and views — nothing more.
2. **Paste the credential** at `/dashboard/connectors` → Snowflake:

   | Field | What it is | Shown |
   |---|---|---|
   | Account identifier | The part of your address before `.snowflakecomputing.com` (`northwind-analytics`, or `xy12345.us-east-1`) | in full |
   | User | The key-pair user | in full |
   | Private key | PEM, `-----BEGIN PRIVATE KEY-----` (or an encrypted one) | masked |
   | Private key passphrase | Only for an encrypted key | masked |

3. **Settings on the source:**

   | Setting | What it does |
   |---|---|
   | Virtual warehouse | Runs the queries. A small one is plenty. |
   | Database | Where an allowed schema written without a database lives. |
   | Role | Optional; the user's default role otherwise. |
   | Allowed schemas | The only schemas a query may read (`MARTS`, `FINANCE.REPORTING`). Required. |
   | Most rows / kilobytes per query | Defaults 1000 rows and 2000 KB; the agent is told when a result was cut. |
   | Statement timeout | Default 60 seconds. |

**Test connection** signs in, says which user, role and warehouse it got, and
checks each allowed schema is visible to that role. It runs a few small
queries, which wakes the warehouse for a moment. No OAuth app is needed.
