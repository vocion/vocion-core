# modules/vocion-stack — AWS Backup.
#
# RDS already keeps automated backups for point-in-time recovery
# (db_backup_retention_days). Those live and die with the instance's account
# and can be deleted by anyone who can delete the instance. This adds the copy
# that cannot:
#
#   - a daily backup of the database into this module's vault, encrypted under
#     the data key;
#   - the vault locked in GOVERNANCE mode: no recovery point is deleted before
#     its retention ends, except by a principal holding
#     backup:DeleteBackupVaultLockConfiguration (a break-glass role, not the
#     operators). Compliance mode, which nobody can undo, is a one-line change
#     (changeable_for_days) once the retention numbers have settled;
#   - optionally, a copy of each backup into a vault in ANOTHER account
#     (backup_copy_vault_arn), so losing this account does not lose the data.
#
# The cross-account copy needs two things this module cannot do from inside
# one account: cross-account backup turned on for the organization (AWS Backup
# settings, in the management account), and the destination vault accepting
# this account (backup_accept_copies_from_account_ids, set on the module call
# that owns that vault). Until both exist, leave backup_copy_vault_arn empty;
# the in-account vault and its lock work on their own.

resource "aws_backup_vault" "main" {
  count = var.backup_enabled ? 1 : 0

  name        = var.name_prefix
  kms_key_arn = local.db_kms_key_arn
}

resource "aws_backup_vault_lock_configuration" "main" {
  count = var.backup_enabled && var.backup_vault_lock_enabled ? 1 : 0

  backup_vault_name  = aws_backup_vault.main[0].name
  min_retention_days = var.backup_vault_lock_min_retention_days
  max_retention_days = var.backup_vault_lock_max_retention_days
  # No changeable_for_days: governance mode.
}

data "aws_iam_policy_document" "backup_vault_accept" {
  count = var.backup_enabled && length(var.backup_accept_copies_from_account_ids) > 0 ? 1 : 0

  statement {
    sid       = "AcceptCopiesFrom"
    effect    = "Allow"
    actions   = ["backup:CopyIntoBackupVault"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = [for a in var.backup_accept_copies_from_account_ids : "arn:${local.partition}:iam::${a}:root"]
    }
  }
}

resource "aws_backup_vault_policy" "main" {
  count = var.backup_enabled && length(var.backup_accept_copies_from_account_ids) > 0 ? 1 : 0

  backup_vault_name = aws_backup_vault.main[0].name
  policy            = data.aws_iam_policy_document.backup_vault_accept[0].json
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  count = var.backup_enabled ? 1 : 0

  name               = "${var.name_prefix}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = var.backup_enabled ? toset([
    "service-role/AWSBackupServiceRolePolicyForBackup",
    "service-role/AWSBackupServiceRolePolicyForRestores",
  ]) : toset([])

  role       = aws_iam_role.backup[0].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/${each.key}"
}

resource "aws_backup_plan" "main" {
  count = var.backup_enabled ? 1 : 0

  name = var.name_prefix

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.main[0].name
    schedule          = var.backup_schedule
    start_window      = 60
    completion_window = 360

    lifecycle {
      delete_after = var.backup_retention_days
    }

    dynamic "copy_action" {
      for_each = var.backup_copy_vault_arn != "" ? [var.backup_copy_vault_arn] : []
      content {
        destination_vault_arn = copy_action.value
        lifecycle {
          delete_after = var.backup_copy_retention_days
        }
      }
    }
  }
}

resource "aws_backup_selection" "db" {
  count = var.backup_enabled ? 1 : 0

  name         = "${var.name_prefix}-db"
  plan_id      = aws_backup_plan.main[0].id
  iam_role_arn = aws_iam_role.backup[0].arn
  resources    = [aws_db_instance.main.arn]
}
