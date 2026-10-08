# modules/vocion-stack — RDS PostgreSQL for the application database.
#
# Private subnets only, reachable from the box's security group only, TLS
# forced, storage and Performance Insights under the data key (kms.tf).
#
# The master password is generated and rotated by RDS in its own secret, which
# the box cannot read. The app connects as its own login, kept in the
# <name_prefix>/rds-app secret (secrets.tf): created once by an operator, see
# "First deploy" in the README.

locals {
  db_major = split(".", var.db_engine_version)[0]
}

resource "aws_db_subnet_group" "main" {
  name        = var.name_prefix
  description = "Private subnets for ${var.name_prefix} RDS"
  subnet_ids  = aws_subnet.db[*].id

  tags = { Name = var.name_prefix }
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "${var.name_prefix} RDS - Postgres from the app box only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name_prefix}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from the app box"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_db_parameter_group" "main" {
  name        = "${var.name_prefix}-pg${local.db_major}"
  family      = "postgres${local.db_major}"
  description = "${var.name_prefix}: extension allowlist incl. pgvector, TLS forced"

  # The allowlist of CREATE EXTENSION targets. Core's migrations create
  # `vector`; a migration that needs another extension must add it here first,
  # or it fails on RDS.
  parameter {
    name  = "rds.allowed_extensions"
    value = join(",", var.db_allowed_extensions)
  }

  # RDS reports this parameter as pending-reboot; without saying so here every
  # plan shows it changing. (It is also PostgreSQL 15+'s default.)
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  # Slow-query visibility in the postgresql log (exported to CloudWatch).
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = var.name_prefix
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name                     = var.db_name
  username                    = var.db_master_username
  manage_master_user_password = true

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = local.db_kms_key_arn

  multi_az               = var.db_multi_az
  availability_zone      = var.db_multi_az ? null : local.box_az # beside the box when single-AZ
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.main.name

  backup_retention_period = var.db_backup_retention_days
  backup_window           = var.db_backup_window
  maintenance_window      = var.db_maintenance_window
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade            = true
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = local.db_kms_key_arn
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  deletion_protection       = var.db_deletion_protection
  delete_automated_backups  = false
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name_prefix}-final"

  tags = { Name = var.name_prefix }
}
