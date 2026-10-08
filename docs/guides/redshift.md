# Amazon Redshift as a warehouse source

A workspace connects Redshift (Serverless or a provisioned cluster) through
the **Redshift Data API**, lists the schemas an agent may read, and every
agent given the source answers from it live with two tools:

- `warehouse_schema` — the allowed schemas, the tables in one, a table's
  columns (`ListTables` / `DescribeTable`).
- `warehouse_query` — one Redshift SQL `SELECT`, rows back.

Nothing is synced or copied into Vocion, and there are **no actions**.

## How read-only is enforced

Each query runs on one Data API **session** (a connection kept open between
calls), in this order:

1. `SET statement_timeout` to the source's limit and `SET search_path` to the
   allowed schemas.
2. `EXPLAIN` the statement. Redshift only plans SELECT, SELECT INTO, CTAS,
   INSERT, UPDATE and DELETE, so DDL, GRANT, CALL or a second statement fail
   here and are refused; a plan with an Insert, Update or Delete step is
   refused too.
3. Every relation the plan scans is looked up in `information_schema.tables`
   (which lists only what the database user can read). One in no allowed
   schema is refused. Because Redshift prints a local table without its
   schema, a name that exists in an allowed schema **and** another readable
   schema is refused as ambiguous — narrow the database user's grants to the
   allowed schemas and it goes away. A row-level-security scan that prints
   only an alias is refused for the same reason.
4. `BEGIN READ ONLY`, the statement exactly as written, `ROLLBACK`. The
   statement is cancelled at the timeout.

Separate `ExecuteStatement` calls on the session are used rather than one
`BatchExecuteStatement`, whose default mode wraps its own transaction around
the list. The database user's grants remain the wall underneath: give it
USAGE on the allowed schemas and SELECT on their tables only.

## Connecting it

**Credential** (`redshift`), one of:

| Shape | Fields | Signs with |
|---|---|---|
| Key pair | Access key ID + secret access key (like the AWS credential) | the pair |
| Role | Role ARN | this server's AWS identity assumes the role with external ID **`vocion-<workspace id>`** (shown by Test connection); the role's trust policy must require it |
| Both | pair + role ARN | the pair assumes the role |

Assumed sessions last 15 minutes. The IAM identity needs
`redshift-data:ExecuteStatement`, `DescribeStatement`, `GetStatementResult`,
`CancelStatement`, `ListSchemas`, `ListTables`, `DescribeTable`, plus
`redshift-serverless:GetCredentials` (serverless) or
`redshift:GetClusterCredentialsWithIAM` / `GetClusterCredentials` (provisioned).

**Settings on the source:** AWS region, database, and a serverless workgroup
*or* a provisioned cluster (with an optional database user, or a Secrets
Manager secret ARN), the allowed schemas (required), and the shared limits —
most rows (1000), most kilobytes (2000), statement timeout (60 s).

**Test connection** signs (assuming the role when named), lists the
database's schemas and checks each allowed one. Nothing is saved.

No OAuth app or env var to register.
