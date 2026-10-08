# modules/vocion-stack — one Vocion installation on AWS.
#
# The module configures no provider. The calling root does, and the region,
# account and credentials all come from there: an installation lives in the
# account and region of the `aws` provider it is handed.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.70, < 6.0"
    }
  }
}
