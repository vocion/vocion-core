# modules/vocion-stack — KMS keys.
#
#   data   RDS storage, Performance Insights and the backup vault. Created
#          unless db_kms_key_arn names one. When backups are copied to another
#          account, that account may use this key to read the copies.
#   vault  The app's credential vault (VOCION_CREDENTIAL_VAULT=kms): every
#          workspace's stored vendor keys are wrapped under data keys from it.
#          Only the box's role may use it (compute.tf).
#
# Both rotate yearly. Deleting either is a 30-day window, not an instant.

locals {
  backup_copy_account_id = var.backup_copy_vault_arn != "" ? split(":", var.backup_copy_vault_arn)[4] : ""
}

data "aws_iam_policy_document" "data_key" {
  count = local.create_db_key ? 1 : 0

  statement {
    sid       = "AccountAdministers"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  dynamic "statement" {
    for_each = local.backup_copy_account_id != "" ? [local.backup_copy_account_id] : []
    content {
      sid    = "BackupCopyAccountReads"
      effect = "Allow"
      actions = [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:CreateGrant",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
      ]
      resources = ["*"]
      principals {
        type        = "AWS"
        identifiers = ["arn:${local.partition}:iam::${statement.value}:root"]
      }
    }
  }
}

resource "aws_kms_key" "data" {
  count = local.create_db_key ? 1 : 0

  description             = "${var.name_prefix}: RDS storage, Performance Insights and backups"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.data_key[0].json
}

resource "aws_kms_alias" "data" {
  count = local.create_db_key ? 1 : 0

  name          = "alias/${var.name_prefix}-data"
  target_key_id = aws_kms_key.data[0].key_id
}

resource "aws_kms_key" "vault" {
  count = var.kms_vault_enabled ? 1 : 0

  description             = "${var.name_prefix}: credential vault (VOCION_CREDENTIAL_VAULT=kms)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "vault" {
  count = var.kms_vault_enabled ? 1 : 0

  name          = "alias/${var.name_prefix}-credential-vault"
  target_key_id = aws_kms_key.vault[0].key_id
}
