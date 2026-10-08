# modules/vocion-stack — the deploy document.
#
# The box's files (the deploy script, Caddy's configs, the compose overlay,
# deploy.env) and whether sshd runs come from templates/. User-data sets them
# once, at first boot, and is ignored after (compute.tf), so on its own a
# change to templates/ would reach only a rebuilt box. This SSM Command
# document, <name_prefix>-deploy, carries the module's current files: run on
# the box, it writes them, then deploys. A template change is then
# `tofu apply` and a deploy.
#
#   aws ssm send-command --instance-ids <instance_id> \
#     --document-name <deploy_document_name> --parameters ref=v5.1.0
#
# With image=<registry>/<repository>:<tag>, the box pulls that image (built
# elsewhere from the same ref) instead of building one.
#
# action=install writes the files without deploying (before an interactive
# `sudo vocion-deploy` in a session, say).

locals {
  box_files = templatefile("${path.module}/templates/box-files.sh.tftpl", {
    region          = local.region
    config_param    = aws_ssm_parameter.deploy.name
    core_repo       = var.core_repo
    core_ref        = var.core_ref
    deploy_script   = chomp(file("${path.module}/templates/vocion-deploy.sh"))
    caddyfile_alb   = chomp(file("${path.module}/templates/Caddyfile.alb"))
    caddyfile_tls   = chomp(file("${path.module}/templates/Caddyfile.tls"))
    compose_overlay = chomp(file("${path.module}/templates/compose.cloud.yml"))
    ssh_enabled     = var.ssh_enabled
  })
}

resource "aws_ssm_document" "deploy" {
  name            = "${var.name_prefix}-deploy"
  document_type   = "Command"
  document_format = "JSON"
  target_type     = "/AWS::EC2::Instance"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy ${var.hostname}: write the vocion-stack module's box files, then run vocion-deploy at a release."
    parameters = {
      action = {
        type          = "String"
        description   = "deploy: write the box files, then deploy. install: write the box files only."
        default       = "deploy"
        allowedValues = ["deploy", "install"]
      }
      ref = {
        type           = "String"
        description    = "The core release to deploy: a tag (v5.1.0) or a full 40-character sha. Empty: the module's core_ref."
        default        = ""
        allowedPattern = "^(|v[0-9]+\\.[0-9]+\\.[0-9]+([-.][0-9A-Za-z.-]+)?|[0-9a-f]{40})$"
      }
      image = {
        type           = "String"
        description    = "A prebuilt app image to pull instead of building on the box (registry/repository:tag or @sha256:digest), built from this ref. Empty: build on the box."
        default        = ""
        allowedPattern = "^(|[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+(:[A-Za-z0-9._-]{1,128})?(@sha256:[0-9a-f]{64})?)$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "vocionDeploy"
      inputs = {
        timeoutSeconds = "5400"
        runCommand     = [templatefile("${path.module}/templates/deploy-document.sh.tftpl", { box_files = local.box_files })]
      }
    }]
  })

  lifecycle {
    precondition {
      # SSM fills in {{ name }} wherever it appears in a command document.
      condition     = !strcontains(local.box_files, "{{")
      error_message = "A box file contains \"{{\", which SSM would read as a document parameter."
    }
  }
}
