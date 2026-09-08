# Deploying Vocion for a client

How to stand up Vocion for one client, and which repo owns what.

Two deployments exist already: `Meta-CTO/metacto-vocion-agents` and
`Veerio-Life/veerio-vocion`. Read this before building a third.

---

## What you build

A **parent project** — one repo per client, holding everything client-specific,
with `vocion-core` pinned inside it as a submodule.

```
<client>-vocion/
├── vocion-core/          the framework, pinned. Never edited here.
├── infra/terraform/      the client's AWS stack
├── infra/aws/            what runs on the box: Caddyfile, compose, bootstrap
├── workspace/<slug>/     agents and sources, as reviewable YAML
├── scripts/deploy.sh     one entrypoint
└── .github/workflows/    push to main redeploys
```

The client runs exactly the core commit their repo pins. Upgrading is a
deliberate commit, never a deploy-time surprise.

---

## Why `infra/terraform` and `infra/aws` are separate

This trips everyone up, because both folders say "infrastructure" and both
concern AWS. They are not two homes for the same thing. **They run in different
places, at different times, with different credentials.**

|  | `infra/terraform/` | `infra/aws/` |
|---|---|---|
| **Runs where** | your laptop, or CI | on the EC2 box, as root |
| **Talks to** | the AWS API | Docker, on that one machine |
| **Written in** | declarative HCL | bash, compose, Caddyfile |
| **Needs** | AWS credentials + the state file | no AWS credentials at all |
| **Runs how often** | rarely — resize, DNS, IAM | every single deploy |
| **When it fails** | apply errors out, nothing changed | box is up but serving badly |

Read it as a handoff:

```
tofu apply                          → creates the machine
  └─ user-data.sh (first boot only) → fetches the secret, clones the repo
       └─ infra/aws/bootstrap.sh    → builds the image, starts the stack
            └─ apply-workspace.sh   → migrations, workspace YAML into the DB

git push origin main                → re-runs bootstrap.sh only
```

`infra/terraform` creates the machine. `infra/aws` is what the machine *does*
once it exists. The first is cattle-shaped and runs from outside; the second
is the box's own runbook and runs from inside.

Merging them would put "needs AWS credentials and a state file" in the same
directory as "runs as root on a box that deliberately has neither", and would
mean editing a Caddy config triggered a Terraform plan.

**The name `infra/aws` is admittedly poor** — `infra/terraform` is also AWS.
`infra/box`, `infra/host` or `runtime/` would all be clearer. The name is kept
because this repo uses it too (`vocion-core/infra/aws/`), several absolute
paths depend on it (`/opt/vocion/infra/aws/Caddyfile` in the compose overlay,
`${CORE}/infra/aws/.env.production` in `bootstrap.sh`), and having the
framework and its parent projects disagree about the layout costs more than the
better name is worth. Rename it in both, or in neither.

---

## The part people miss

**A deployment has two phases, and the second one lives in this repo.**

| | Phase 1 — the box | Phase 2 — the agent runtime |
|---|---|---|
| Lives in | parent project | **here**, `infra/agentcore/` |
| Builds | VPC, EC2, EBS, Elastic IP, Route 53, IAM, snapshots. Then Caddy, Postgres, Langfuse, Temporal, the app. | ECR repo, execution role, Memory store, arm64 image, the runtime itself |
| Tool | OpenTofu + `bootstrap.sh` | `provision.sh`, `deploy-runtime.sh`, `smoke-invoke.sh` |

Skip phase 2 and **the site comes up healthy while chat fails**. Any agent with
`harness.provider: agentcore` has nowhere to execute until the runtime exists.

Langfuse is the one part of phase 1 that needs a decision rather than a
script: managed Cloud, self-hosted on the box, or off. Make it before
the first deploy, since the self-hosted path sets the admin password and
the project API keys on first boot.
[`observability.md`](./observability.md) covers all three.

### Call these scripts. Don't copy them.

They read `ENV`, `AWS_PROFILE` and `REGION` from the environment, and each one
is idempotent:

```bash
ENV=production AWS_PROFILE=<profile> REGION=<region> \
  bash vocion-core/infra/agentcore/provision.sh

ENV=production AWS_PROFILE=<profile> REGION=<region> \
  bash vocion-core/infra/agentcore/deploy-runtime.sh

ENV=production AWS_PROFILE=<profile> REGION=<region> \
  bash vocion-core/infra/agentcore/smoke-invoke.sh
```

Copying them lets a parent project drift from the version it pins. Calling them
makes that impossible.

`Veerio-Life/veerio-vocion` wires this into `scripts/deploy.sh`:

```bash
./scripts/deploy.sh apply       # phase 1
./scripts/deploy.sh agentcore   # phase 2
./scripts/deploy.sh all         # both
```

Phase 2 is a separate action because it needs Docker and builds a linux/arm64
image. A plain infrastructure change shouldn't require either.

### Migrations are the same rule, and this is where it has already bitten

Call `vocion-core/infra/aws/apply-migrations.sh`. Do not write your own loop
over `packages/core/migrations/*.sql`.

```bash
sudo MIGRATIONS_DIR=<checkout>/vocion-core/packages/core/migrations \
  POSTGRES_CONTAINER=<your-pg-container> POSTGRES_DB=<your-db> \
  bash <checkout>/vocion-core/infra/aws/apply-migrations.sh
```

A hand-rolled loop looks like four lines and works, right up until core adds
something the loop does not know about. Core keeps a second class of migration
in `packages/core/migrations/concurrent/` — index builds written as
`CREATE INDEX CONCURRENTLY`, because a plain `CREATE INDEX` on a populated
table blocks every write to it until the build finishes. A non-recursive glob
skips that directory in silence: the numbered migration lands, the index build
does not, and the deploy reports success.

That is not hypothetical. `Veerio-Life/veerio-vocion` applies migrations from
its own `apply-workspace.sh` with exactly such a glob, so core's applier has
never run there — confirmed against both of its environments, whose migration
history lives in a `schema_migration` table core knows nothing about.

Calling core's script also gets you the parts nobody thinks to write twice: the
baselining path for a database whose schema predates the tracking table,
dropping `--single-transaction` only for the statements Postgres actually
refuses inside one, and stopping rather than skipping ahead when a migration
fails.

**If a parent project must keep its own applier**, end its deploy with:

```bash
sudo MIGRATIONS_DIR=... POSTGRES_CONTAINER=... POSTGRES_DB=... \
  bash <checkout>/vocion-core/infra/aws/apply-migrations.sh --verify-indexes
```

That reads the database and nothing else — no tracking table, no baselining, no
migrations — and exits non-zero naming any index declared in `concurrent/` that
is missing, or that a failed build left `INVALID` (present, never used, and
skipped forever by `IF NOT EXISTS`). It turns the silent case into a failed
deploy.

**Moving an existing project onto core's applier** needs one baseline, because
its history is in its own table and core's applier reads `__pgsql_migrations`:

```bash
# once, on the box, after confirming the schema is current
sudo ... bash .../apply-migrations.sh --baseline all
```

Then every later deploy is a normal run. Run `--check` first to see what it
would do.

### Wire the app to the runtime

Provisioning creates the runtime. It does not tell the app to use it — that is
five environment variables, and getting one wrong fails in a way that looks
like a model problem rather than a config problem.

`provision.sh` and `deploy-runtime.sh` write what they created to SSM under
`/vocion/agentcore/<env>/`: `runtime-arn`, `memory-id`, `runtime-image`,
`runtime-role-arn`, `ecr-repo-uri`. **Read those at deploy time. Do not paste
an ARN into a compose file or a tfvars** — the runtime is redeployed far more
often than the parent project's infrastructure, and a pasted ARN is how an
environment ends up invoking last month's image.

| Var | Value | What breaks without it |
|---|---|---|
| `VOCION_AGENT_RUNTIME_ARN` | SSM `runtime-arn` | Core falls back to `VOCION_AGENT_RUNTIME_URL` (default `http://localhost:8080`) and every agent turn fails to connect. Chat is broken, the site is fine. |
| `VOCION_TOOL_ENDPOINT_URL` | `https://<the client's core>/api/internal/agent-tools` | The runtime executes the loop but **every tool call fails**, because the default is localhost and AWS cannot reach it. The agent answers, badly, from the model alone. |
| `VOCION_AGENTCORE_REGION` | the region the runtime was provisioned in | Core signs `InvokeAgentRuntime` against `us-west-2` and cannot find a runtime provisioned elsewhere. |
| `VOCION_AGENTCORE_MEMORY_ID` | SSM `memory-id` | Conversations still work — history rides the payload — but nothing is remembered across conversations. |
| `VOCION_BEDROCK_SESSION_SECONDS` | optional, default 3600 | Nothing. Only shorten or lengthen the STS session if you have a reason. |

`VOCION_TOOL_ENDPOINT_URL` is the one that surprises people. Every domain tool
an agent has — knowledge search, CRM lookups, learnings, briefings, all of them
— is executed by core, not by the runtime; the runtime calls back over HTTP
with a signed tenant claim. So the client's core has to be reachable from AWS,
over TLS, before a deployed agent can do anything but talk. The endpoint
verifies the claim on every request and is safe to expose, but it is a tenant
boundary: terminate TLS properly and don't put it behind a wildcard that also
serves something else.

Model spend follows the org's stored AWS key. Core mints a short-lived STS
session from the key the client saved at `/dashboard/api-tokens` and sends it
in the invocation, so Bedrock is billed to their account. If they have stored
no key, the runtime signs with its own execution role and the bill is ours —
which is the right fallback for a trial and the wrong one for a paying client,
so check it during handover rather than assuming.

### Who runs the deploy

The parent project, never core. Core holds no AWS account and no credentials,
so it cannot deploy a runtime anywhere. The scripts under `infra/agentcore/`
are the shared implementation; the parent project calls them with its own
profile and environment. Veerio's wrapper is
`./scripts/deploy.sh agentcore <env>`.

Core used to carry a workflow that deployed a runtime into MetaCTO's own
account. It was never activated, and it was the wrong shape — it made core
look like the thing that owns a deployment. Removed. What every client project
does need is its own path to the same deploy, which is the next section.

### One-time: let the client project's CI deploy the runtime

Two steps per client account, then that project's pipeline can deploy
unattended.

**1. Create the deploy role in the client's account.** This is deliberately
manual and deliberately human: it creates federated trust between GitHub and
an AWS account.

```bash
TRUSTED_REPO=Veerio-Life/veerio-vocion \
AWS_PROFILE=veerio REGION=us-west-2 \
  bash vocion-core/infra/agentcore/provision-ci-role.sh
```

The role it creates admits exactly one repo at one ref (`refs/heads/main` by
default, `TRUSTED_REF` to change it) and carries only what `deploy-runtime.sh`
and `smoke-invoke.sh` need: ECR push, AgentCore create/update/get/invoke,
`iam:PassRole` for the runtime role, and read/write on
`/vocion/agentcore/*` parameters. Pass `ROLE_NAME` when one account serves
more than one project.

The script prints the `gh secret set` line to run next.

**2. Call the scripts from the client project's workflow.** They need the
submodule checked out, QEMU for the arm64 build, and the role above:

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: actions/checkout@v4
    with:
      submodules: recursive

  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
      aws-region: us-west-2

  - uses: docker/setup-qemu-action@v3
    with:
      platforms: arm64

  - run: ENV=production bash vocion-core/infra/agentcore/deploy-runtime.sh
  - run: ENV=production bash vocion-core/infra/agentcore/smoke-invoke.sh
```

Do this once per environment. SSM is namespaced per environment
(`/vocion/agentcore/<env>/`, see
[`multiple-environments.md`](./multiple-environments.md)), so two environments
never share a runtime by accident.

The runtime artifact is generic — agent definitions travel in the invocation
payload — so this pipeline only needs to run when `packages/agent-runtime`
changes, not when an agent is edited.

---

## Gotchas

Three defaults that are wrong for any client outside `us-east-1`:

| What | Where | Effect |
|---|---|---|
| Region defaults to `us-east-1`, passed positionally | `agentcore-harness-role.sh` | Harness role lands in the wrong region, silently. |
| `VOCION_AGENTCORE_REGION` defaults to `us-east-1` | `services/agents/providers/agentcore.ts` | Agents run their model loop in a region nobody chose. Set it in the parent's compose overlay, for the app *and* the worker. |
| Agent with no `model` resolves to `gpt-4o` | workspace applier | Only bites the `local` provider — `agentcore` agents use `harness.model` — but it bites quietly. Pin every model explicitly. |

**One more, on secrets.** Both parent projects create the Secrets Manager entry
out-of-band and reference it from Terraform as a data source, so API keys never
enter state or `tfvars`. This repo's own `infra/terraform` *creates* the secret
instead. Copy the parent form, not this one.

---

## Pinning `vocion-core`

Three rules, each earned the hard way:

1. **Take the SHA from `git ls-remote`, never a local checkout.** This repo's
   history was rewritten on 2026-08-31 after the PolinRider compromise, and a
   plain `git fetch` doesn't clobber stale local tags. A local clone will hand
   you a tag pointing at a different object.
2. **Use the `v2.x` tags.** An orphan `vocion-v0.5.x` series exists that shares
   no ancestor with `main`.
3. **Run `node scripts/check-config-integrity.mjs` at the new pin before you
   commit it**, and re-check the pin after every merge — a GitHub merge can move
   a submodule pin backwards.
4. **A pin bump is two deploys.** Bumping the pin and deploying the app box
   leaves the agent runtime container on its old image, so the app runs new
   code while the agent loop runs old code and nothing says so. The deployed
   image's tag carries the core commit it was built from, so whether the
   container moved is checkable rather than a judgement call:

   ```bash
   aws ssm get-parameter --name "/vocion/agentcore/<env>/runtime-image" \
     --query 'Parameter.Value' --output text
   git -C vocion-core diff --stat <that-commit>..HEAD -- packages/agent-runtime
   ```

   Empty diff, the container is current. Any output, every environment needs
   `deploy-runtime.sh` as well — and every environment separately, since each
   has its own ECR repository and runtime.

---

## Paste this into a new client project's `CLAUDE.md`

A parent project needs its own `CLAUDE.md`, because the two-deploys rule is the
one thing a session working in that repo cannot infer from the code in front of
it. Adjust the wrapper command names to whatever that project calls them:

```markdown
## A deploy is two deploys

The deploy workflow and `./scripts/deploy.sh apply <env>` update the **app box**
only — sync the checkout, re-run bootstrap, health-gate the URL. They never
touch the agent runtime container.

`./scripts/deploy.sh agentcore <env>` is the second deploy: it builds the arm64
image from `vocion-core/packages/agent-runtime`, pushes it to ECR and updates
the AgentCore Runtime.

After bumping the core pin, deploy both, for every environment, unless
`packages/agent-runtime` is unchanged between what is deployed and the new pin.
The deployed image's tag carries the core commit it was built from:

    aws ssm get-parameter --name "/vocion/agentcore/<env>/runtime-image" \
      --query 'Parameter.Value' --output text
    git -C vocion-core diff --stat <that-commit>..HEAD -- packages/agent-runtime

Empty diff means the container is current. Any output means every environment
needs the agentcore deploy, and a deploy reported as done without it is half a
deploy.

Editing an agent's YAML never needs a container deploy — the artifact is
generic, so agent definitions travel in the invocation payload.

## Migrations: call core's applier

Apply migrations by calling core's script, never by looping over
`packages/core/migrations/*.sql` here:

    sudo MIGRATIONS_DIR=/opt/<project>/vocion-core/packages/core/migrations \
      POSTGRES_CONTAINER=<pg-container> POSTGRES_DB=<database> \
      bash /opt/<project>/vocion-core/infra/aws/apply-migrations.sh

Core keeps index builds that must not lock the table in
`packages/core/migrations/concurrent/`. A glob over the migrations directory
skips that subdirectory silently — the schema change lands, the index does
not, and the deploy still reports success.

If this project keeps its own applier, end every deploy with the same script
under `--verify-indexes`. It reads the database and nothing else, and fails
naming any of those index builds that is missing or `INVALID`:

    sudo MIGRATIONS_DIR=... POSTGRES_CONTAINER=... POSTGRES_DB=... \
      bash .../vocion-core/infra/aws/apply-migrations.sh --verify-indexes
```

---

## Known problem: three copies of the same stack

`infra/terraform` here isn't a library. It's a fourth deployment that happens to
live in the framework repo — which is exactly why every parent project copies
it.

Measured at `v2.21.0` against the Veerio copy: `main.tf` is **295 lines, 92
differing, and 29 of those differences are just resource names and tags.**

The fix, when someone has room:

```
infra/terraform/
├── modules/vocion-stack/     everything shared
└── environments/vocion-ai/   this repo's deployment, reduced to a module call
```

Parent projects then keep only an overlay:

```hcl
module "vocion" {
  source = "../../vocion-core/infra/terraform/modules/vocion-stack"

  project_name   = "<client>-vocion"
  apex_domain    = var.apex_domain
  instance_type  = var.instance_type
  data_volume_gb = var.data_volume_gb
  secret_name    = "<client>-vocion/production"
}
```

No Terraform registry needed — **the submodule pin already versions it**, so a
client's infrastructure and application move together on one SHA.

Sequence: extract the module here, prove it with `environments/vocion-ai`
against a real deployment, cut a release, then let parent projects bump their
pin and swap `.tf` files for a module call. Extraction means `terraform state
mv` against a live box, so give it its own change and its own rollback plan.
