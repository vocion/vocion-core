# The smallest root that stands up one Vocion installation with the module.
#
#   tofu init && tofu apply -var 'route53_zone_id=Z0123456789EXAMPLE'
#
# It assumes a hosted zone for the hostname already exists in this account.
# Remote state, the zone itself and its delegation belong to your own root;
# this example keeps state locally.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.70, < 6.0"
    }
  }
}

variable "region" {
  description = "Region for the installation."
  type        = string
  default     = "us-east-1"
}

variable "hostname" {
  description = "Hostname to serve."
  type        = string
  default     = "app.example.com"
}

variable "route53_zone_id" {
  description = "Hosted zone in this account that holds hostname."
  type        = string
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "vocion"
      ManagedBy = "opentofu"
      Env       = "example"
    }
  }
}

module "vocion" {
  source = "../.."

  name_prefix     = "vocion-example"
  environment     = "example"
  azs             = ["${var.region}a", "${var.region}b"]
  hostname        = var.hostname
  route53_zone_id = var.route53_zone_id
  core_ref        = "v5.0.0"

  # Non-secret settings, merged over the app-env secret on every deploy.
  app_env = {
    VOCION_ENFORCE_WORKSPACE_ACCESS = "1"
    VOCION_MAIL_ENABLED             = "0"
    LANGFUSE_ENABLED                = "false"
  }

  # A throwaway install: smaller, and easy to tear down.
  instance_type             = "r6i.large"
  db_instance_class         = "db.t4g.medium"
  db_deletion_protection    = false
  backup_vault_lock_enabled = false
}

output "url" {
  value = module.vocion.url
}

output "session_command" {
  value = module.vocion.session_command
}

output "instance_id" {
  value = module.vocion.instance_id
}

output "db_address" {
  value = module.vocion.db_address
}

output "app_env_secret_name" {
  value = module.vocion.app_env_secret_name
}

output "rds_app_secret_name" {
  value = module.vocion.rds_app_secret_name
}

output "db_master_secret_arn" {
  value = module.vocion.db_master_secret_arn
}
