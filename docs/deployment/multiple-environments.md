# Running multiple environments

How to give a client deployment more than one environment — production and
dev, say — without copying anything.

Written from doing it on `Veerio-Life/veerio-vocion`, which runs
`agents.veerio.app` and `dev.agents.veerio.app` from one repository.

See also: [the parent-project pattern](./parent-project-pattern.md).

---

## The rule

**Environments are OpenTofu workspaces, not copied directories.**

Both environments run the same Terraform, the same scripts, the same
`workspace/` YAML. The only thing that differs is one variables file each.

For a real example, the entire difference between two live environments:

| Variable | production | dev |
|---|---|---|
| `environment` | `production` | `dev` |
| `apex_domain` | `agents.veerio.app` | `dev.agents.veerio.app` |
| `hosted_zone_id` | `""` (creates the zone) | the production zone's id |
| `instance_type` | `r6i.xlarge` | `r6i.large` |
| `data_volume_gb` | `150` | `100` |

Eight other values — account, region, profile, key pair, SSH range, root
volume, repo, branch — are identical.

---

## What `environment` drives

One variable, four consequences:

1. **The OpenTofu workspace**, and therefore which state file in S3 is read and
   written. Environments cannot see each other's resources.
2. **Resource names**, through a `name_prefix` local.
3. **The Secrets Manager entry**, via `"<project>/${var.environment}"`.
4. **The AgentCore environment**, since `infra/agentcore/*.sh` namespace their
   SSM parameters under `/vocion/agentcore/<env>/`.

---

## Do this from day one

**Derive every resource name from the environment in your first commit**, even
if you only ever plan to have one environment.

```hcl
locals {
  name_prefix = "<project>-${var.environment}"
}
```

IAM role, policy and instance-profile names are **unique per AWS account**. A
stack with hardcoded names applies fine the first time and then collides the
moment a second workspace exists.

Retrofitting is worse than it sounds. Renaming an existing environment's
resources makes Terraform **replace** its IAM role, instance profile and
security group — on a box already serving traffic. The Veerio deployment hit
exactly this and had to keep production as a special case:

```hcl
locals {
  # production keeps its original unsuffixed names because it was built before
  # dev existed; renaming would replace live resources for no benefit.
  name_prefix = var.environment == "production" ? "<project>" : "<project>-${var.environment}"
}
```

That conditional is permanent scar tissue from a decision made in the first
hour. Avoid needing it.

---

## Backend layout

Give the backend a workspace prefix so each environment gets its own state
file under one bucket:

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

State then lands at `env/production/terraform.tfstate` and
`env/dev/terraform.tfstate`.

---

## Make the second environment cost nothing in DNS

Give the non-production environment a **subdomain of the production
hostname** — `dev.agents.example.com`, not `agents-dev.example.com`.

A sibling subdomain needs its own hosted zone and its own NS delegation from
wherever the parent domain is hosted, which usually means waiting on someone
else before TLS can issue. A child of the production hostname lives inside the
zone the stack already created: set `hosted_zone_id` to that zone, and the
record is just created. No delegation, no waiting, certificate issues on first
boot.

---

## Wire the environment through the deploy script

Take it as an argument, default to production, and print it before doing
anything:

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

Printing the environment on the first line of output is worth more than it
looks — it is the only thing standing between a tired operator and applying
dev's plan to production.

---

## Adding an environment

1. Copy a tfvars file, change `environment`, `apex_domain` and the sizes.
2. Create its Secrets Manager entry — one per environment.
3. `./scripts/deploy.sh apply <name>`. The workspace is created on first run.

No Terraform changes. That is the test of whether this pattern is set up
correctly: **adding an environment should touch no `.tf` file at all.**

---

## Two things that bite

**The database password must match what Postgres was initialised with.** Core's
compose creates the container with `POSTGRES_PASSWORD=postgres`. Putting a
different password in the environment secret does not change the database — it
just means the app cannot authenticate, while the site still serves its sign-in
page perfectly. Either use the compose default or `ALTER USER` once the box is
up.

**`profiles: []` does not clear a base profile.** Core's dev compose gates the
temporal worker behind `profiles: [worker]`. An overlay declaring `profiles: []`
does not override it — the service silently vanishes from the merged config and
scheduled automations fire into a queue nobody drains. Set
`COMPOSE_PROFILES=worker` instead, and pair it with `--scale worker=0`, because
the same profile also pulls in core's dev `worker` service, which crash-loops on
the standalone production image.
