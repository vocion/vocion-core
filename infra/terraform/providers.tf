# Vocion AWS deploy — OpenTofu providers.
#
# `tofu` reads ~/.aws/credentials for the named profile. The default
# is `metacto` (override via terraform.tfvars). No credentials are
# baked into state.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Local state by default. To migrate to S3 + DynamoDB lock-table
  # later, uncomment the backend block below, run `tofu init -migrate-state`.
  # backend "s3" {
  #   bucket         = "vocion-tfstate"
  #   key            = "production/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "vocion-tfstate-lock"
  #   encrypt        = true
  #   profile        = "metacto"
  # }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "vocion"
      ManagedBy = "opentofu"
      Env       = var.environment
    }
  }
}
