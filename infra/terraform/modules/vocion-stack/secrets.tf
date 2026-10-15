# modules/vocion-stack — Secrets Manager.
#
# The module manages each secret's NAME, never its VALUE: there is no
# aws_secretsmanager_secret_version anywhere, so no credential enters state,
# tfvars or a plan. Values are put out-of-band:
#
#   aws secretsmanager put-secret-value --secret-id <name> --secret-string file://<file>
#
# and reach the box on its next `sudo vocion-deploy`.

# The app's env payload: one JSON object, keys are env var names. The
# secret half of .env.production (AUTH_SECRET, VOCION_TOOL_SIGNING_SECRET,
# model keys, ...). The non-secret half comes from the module (compute.tf).
resource "aws_secretsmanager_secret" "app_env" {
  name                    = "${var.name_prefix}/app-env"
  description             = "${var.hostname}: the app's secret env (JSON object of env var name -> value)"
  recovery_window_in_days = var.secret_recovery_window_days
}

# The app's own database login: {"username": "...", "password": "..."}. The
# deploy builds DATABASE_URL from it, the RDS endpoint and the RDS CA bundle.
resource "aws_secretsmanager_secret" "rds_app" {
  name                    = "${var.name_prefix}/rds-app"
  description             = "${var.hostname}: the app's RDS login (JSON: username, password). Not the master user."
  recovery_window_in_days = var.secret_recovery_window_days
}
