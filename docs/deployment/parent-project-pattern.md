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

---

## Gotchas

Four defaults that are wrong for any client outside `us-east-1`:

| What | Where | Effect |
|---|---|---|
| `REPO_FILTER` hardcoded to `repo:vocion/vocion-core:ref:refs/heads/main` | `infra/agentcore/provision-ci-role.sh:18` | The OIDC role it creates only admits core's own CI. A parent project's pipeline can't assume it — run phase 2 from an operator machine until this is parameterised. |
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
