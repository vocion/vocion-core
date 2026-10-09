# Running multiple environments

Give a client deployment a second environment without copying anything.

Companion to [the parent-project pattern](./parent-project-pattern.md).

---

## With `modules/vocion-stack`

**An environment is one call to
[`modules/vocion-stack`](../../infra/terraform/modules/vocion-stack/README.md).**
The module derives every name (IAM roles, security groups, secrets, the RDS
identifier, the media bucket, the SSM parameter) from `name_prefix`, so the
day-one rule below is already done for you. Two shapes, depending on where the
environments live:

- **One AWS account per environment** (recommended: a broken dev apply cannot
  touch production, and each account's bill is the environment's bill). One
  small root per environment, each with its own backend and provider, calling
  the module at the same pin:

  ```
  infra/terraform/
  ├── production/main.tf   provider → prod account; module "vocion" { name_prefix = "<project>-prod", ... }
  └── dev/main.tf          provider → dev account;  module "vocion" { name_prefix = "<project>-dev",  ... }
  ```

- **One account, several environments.** One root and OpenTofu workspaces, as
  described below, with `name_prefix = "<project>-${terraform.workspace}"`.

Either way, the difference between environments is a handful of inputs. A
production and dev pair on the Cloud profile:

| Input | production | dev |
|---|---|---|
| `name_prefix` | `<project>-prod` | `<project>-dev` |
| `hostname` | `app.example.com` | `dev.app.example.com` |
| `route53_zone_id` | the `app.example.com` zone | the `dev.app.example.com` zone |
| `instance_type` | `r6i.xlarge` | `r6i.large` |
| `db_instance_class` | `db.m7g.large` | `db.t4g.medium` |
| `db_multi_az` | `true` | `false` |
| `db_backup_retention_days` | `14` | `7` |

`core_ref` is the same in both until a release is promoted: dev moves first
(`sudo vocion-deploy <tag>` on its box), production follows.

**DNS across accounts.** The module writes records only into a zone in its own
account. With one account per environment, each environment's hostname gets its
own zone in its own account, and the parent zone delegates to it with a single
NS record: `dev.app.example.com` lives in the dev account and is delegated from
the `app.example.com` zone in production. One record, made once, in the parent
zone's account.

The rest of this page predates the module and describes the single-root,
workspace-per-environment shape. Its rules still hold for that shape.

---

## The idea

**Environments are OpenTofu workspaces, not copied directories.**

Same Terraform. Same scripts. Same `workspace/` YAML. One variables file each.

A real example (the client parent project, anonymised here as
`Larkfield-Systems/larkfield-vocion` — see `docs/deployment/parent-project-pattern.md`)
runs two environments, and this table is the *entire* difference between them:

| Variable | production | dev |
|---|---|---|
| `environment` | `production` | `dev` |
| `apex_domain` | `agents.larkfield.example` | `dev.agents.larkfield.example` |
| `hosted_zone_id` | `""` (creates a zone) | the production zone's id |
| `instance_type` | `r6i.xlarge` | `r6i.large` |
| `data_volume_gb` | `150` | `100` |

Eight other values are identical.

---

## One variable, four effects

`environment` decides:

- **Which workspace** → which state file → environments can't see each other.
- **Resource names**, via a `name_prefix` local.
- **Which secret**, via `"<project>/${var.environment}"`.
- **Which AgentCore namespace**, since `infra/agentcore/*.sh` write to
  `/vocion/agentcore/<env>/`.

---

## Do this on day one

Derive every resource name from the environment in your **first commit**, even
with one environment planned:

```hcl
locals {
  name_prefix = "<project>-${var.environment}"
}
```

**Why it can't wait:** IAM role, policy and instance-profile names are unique
per AWS account. Hardcoded names work perfectly once, then collide the moment a
second workspace exists.

**Why retrofitting hurts:** renaming makes Terraform *replace* the IAM role,
instance profile and security group — on a box already serving traffic. Larkfield
hit this and now carries a conditional forever:

```hcl
locals {
  # production keeps its original names; renaming would replace live resources
  name_prefix = var.environment == "production" ? "<project>" : "<project>-${var.environment}"
}
```

That line is scar tissue from an hour-one decision.

---

## Backend

One bucket, one state file per environment:

```hcl
backend "s3" {
  bucket               = "<project>-tfstate"
  key                  = "terraform.tfstate"
  workspace_key_prefix = "env"
  region               = "<region>"
  dynamodb_table       = "<project>-tfstate-lock"
  encrypt              = true
  profile              = "<profile>"
}
```

Gives you `env/production/terraform.tfstate` and `env/dev/terraform.tfstate`.

---

## Pick the hostname carefully

Use `dev.agents.example.com` — a **child** of the production hostname.

Not `agents-dev.example.com`.

A sibling subdomain needs its own hosted zone and its own NS delegation from
wherever the parent domain lives, which usually means waiting on another team
before HTTPS works. A child lives in the zone your stack already created: point
`hosted_zone_id` at it and the record just appears. No delegation, no waiting,
certificate issues on first boot.

---

## Thread it through the deploy script

```bash
readonly ACTION="${1:-plan}"
readonly ENVIRONMENT="${2:-production}"

readonly TFVARS="${REPO_DIR}/infra/terraform.tfvars.${ENVIRONMENT}"
readonly APP_SECRET_NAME="<project>/${ENVIRONMENT}"
readonly WORKSPACE_NAME="${ENVIRONMENT}"
```

```
./scripts/deploy.sh apply          # production
./scripts/deploy.sh apply dev      # dev
```

Print the environment on the first line of output. It's the only thing between
a tired operator and applying dev's plan to production.

---

## Adding an environment

1. Copy a tfvars file; change `environment`, `apex_domain`, the sizes.
2. Create its Secrets Manager entry.
3. `./scripts/deploy.sh apply <name>` — the workspace is created on first run.

**The test of whether you've set this up right: adding an environment touches
no `.tf` file at all.**

---

## Two failures that stay silent

**The database password must match what Postgres was initialised with.**
(Compose Postgres only. On `modules/vocion-stack` the database is RDS and
`DATABASE_URL` is built from the `<name_prefix>/rds-app` secret on every
deploy, so the two cannot disagree.)

Core's compose creates the container with `POSTGRES_PASSWORD=postgres`. A
different password in your environment secret doesn't change the database — the
app just can't log in, while the sign-in page keeps serving normally. Use the
compose default, or `ALTER USER` once the box is up.

**`profiles: []` does not clear a base profile.**

Core's dev compose gates the feedback worker behind `profiles: [worker]`. An
overlay declaring `profiles: []` doesn't override it — the service vanishes from
the merged config, and the feedback queue is never drained.

Set `COMPOSE_PROFILES=worker` instead, paired with `--scale worker=0`: the same
profile also pulls in core's dev `worker` service, which crash-loops on the
standalone production image.
