# Daily EBS snapshots of the data volume.
#
# infra/aws/README.md has claimed for a while that "EBS snapshots cover
# Postgres + Langfuse data". Nothing created them: there was no snapshot
# lifecycle policy in this stack at all, so the only copy of the
# application database, and of Langfuse's ClickHouse and Postgres, was
# the live volume.
#
# This is a Data Lifecycle Manager policy rather than a cron on the box,
# so snapshots keep happening when the instance is stopped, wedged, or
# has had its crontab lost to a rebuild.
#
# Two things this does not do, both on purpose:
#
#   * It does not snapshot the root volume. Everything on it is either
#     rebuildable from the repository or, since bootstrap.sh moves
#     Docker's data-root onto the data volume, not there any more.
#   * It does not quiesce Postgres first. A snapshot is crash
#     consistent, which Postgres recovers from on start the way it
#     recovers from a power cut. Point-in-time recovery would need
#     WAL archiving, which is a separate decision.

resource "aws_dlm_lifecycle_policy" "data_volume_daily" {
  description        = "Vocion ${var.environment} — daily snapshot of the data volume"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]

    # Selected by tag, so the policy keeps working if the volume is
    # ever replaced. aws_ebs_volume.data carries Name = "vocion-data".
    target_tags = {
      Name = "vocion-data"
    }

    schedule {
      name = "daily"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        # 07:00 UTC — early morning in US time zones, so the snapshot's
        # brief IO hit lands away from the working day.
        times = ["07:00"]
      }

      retain_rule {
        count = var.snapshot_retention_count
      }

      # Volume tags are not copied to snapshots automatically, and
      # without them a console full of snapshots says nothing about
      # what they came from.
      copy_tags = true

      tags_to_add = {
        SnapshotCreator = "dlm"
        Environment     = var.environment
      }
    }
  }

  tags = { Name = "vocion-data-daily-snapshots" }
}

# ----- IAM for Data Lifecycle Manager -----

data "aws_iam_policy_document" "dlm_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "dlm" {
  name               = "vocion-dlm-lifecycle-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume_role.json

  tags = { Name = "vocion-dlm-lifecycle" }
}

# AWS maintains this managed policy for exactly this purpose: create,
# tag and delete snapshots, and nothing else.
resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}
