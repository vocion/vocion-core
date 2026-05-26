# Vocion AWS deploy — input variables.
#
# Defaults reflect the decisions locked in
# /Users/chrisfitkin/.claude/plans/reactive-sleeping-micali.md.
# Override any of them by editing terraform.tfvars.

variable "aws_profile" {
  description = "Named AWS CLI profile. Defaults to `metacto`, which resolves to account 339712698650 (where the vocion.ai hosted zone lives)."
  type        = string
  default     = "metacto"
}

variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "AZ for the public subnet + EBS volumes."
  type        = string
  default     = "us-east-1a"
}

variable "environment" {
  description = "Tag value for all resources. Used in resource names."
  type        = string
  default     = "production"
}

# ----- DNS -----

variable "hosted_zone_id" {
  description = "Route 53 hosted zone id for vocion.ai. Provided by the operator on 2026-05-12."
  type        = string
  default     = "Z06298783TMOTVTWTEX01"
}

variable "apex_domain" {
  description = "Apex hostname served from the EC2 (e.g. vocion.ai)."
  type        = string
  default     = "vocion.ai"
}

variable "www_subdomain" {
  description = "Optional www. alias. Set to empty string to skip the www record."
  type        = string
  default     = "www.vocion.ai"
}

# ----- Compute -----

variable "instance_type" {
  description = "EC2 instance type. r6i.2xlarge = 8 vCPU / 64 GB / ~$0.50/hr."
  type        = string
  default     = "r6i.2xlarge"
}

variable "root_volume_gb" {
  description = "Root EBS size in GB."
  type        = number
  default     = 32
}

variable "data_volume_gb" {
  description = "Data EBS size in GB (Postgres + Caddy certs)."
  type        = number
  default     = 100
}

variable "key_name" {
  description = "Name of an existing EC2 key pair (created out-of-band). Used for SSH access."
  type        = string
}

variable "ssh_cidr" {
  description = "CIDR allowed to SSH to port 22. Default 0.0.0.0/0 — tighten this to your operator IP."
  type        = string
  default     = "0.0.0.0/0"
}

# ----- App ref -----

variable "git_repo" {
  description = "Git URL the EC2 clones on first boot."
  type        = string
  default     = "https://github.com/vocion/core.git"
}

variable "git_ref" {
  description = "Git ref to check out (branch, tag, or sha)."
  type        = string
  default     = "main"
}

# ----- Secrets payload -----

variable "secret_payload" {
  description = <<-EOT
    Key/value pairs written verbatim to /opt/vocion/infra/aws/.env.production
    on the EC2. The map's keys are env var names; values are the secret
    bodies. Pre-fill via terraform.tfvars; the map is then stored as a
    single Secrets Manager JSON blob.

    The keys here mirror infra/aws/.env.production.example. If you add a
    new env var, add it here too.
  EOT
  type        = map(string)
  sensitive   = true
  default     = {}
}
