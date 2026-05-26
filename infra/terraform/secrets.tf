# Vocion AWS deploy — Secrets Manager.
#
# One secret, JSON-encoded map of env-var name → value. EC2 instance
# fetches this on first boot via user-data and writes the resulting
# .env.production file to /opt/vocion/infra/aws/.env.production.

resource "aws_secretsmanager_secret" "production" {
  name        = "vocion/production"
  description = "Env vars consumed by the Vocion EC2 — Anthropic / Clerk / Langfuse keys + DATABASE_URL + VOCION_HOSTNAME."

  # 7-day deletion window — gives the operator a recovery path if
  # `tofu destroy` was a mistake.
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "production" {
  secret_id     = aws_secretsmanager_secret.production.id
  secret_string = jsonencode(var.secret_payload)

  # Skip re-versioning when only the payload's tags changed.
  lifecycle {
    ignore_changes = [version_stages]
  }
}
