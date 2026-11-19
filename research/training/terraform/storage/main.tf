# The bucket that holds the training datasets, checkpoints and finished
# weights. Its own stack so that tearing the training machines down
# (../compute) can never touch the weights.
#
#   terraform init && terraform apply
#   terraform output -raw bucket

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "region" {
  type    = string
  default = "us-east-1"
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "me" {}

resource "aws_s3_bucket" "training" {
  bucket = "followthrough-training-${data.aws_caller_identity.me.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "training" {
  bucket                  = aws_s3_bucket.training.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# In-progress checkpoints are only useful while a run is going; a week is
# far longer than any run. Finished weights under weights/ are kept.
resource "aws_s3_bucket_lifecycle_configuration" "training" {
  bucket = aws_s3_bucket.training.id
  rule {
    id     = "expire-run-checkpoints"
    status = "Enabled"
    filter {
      prefix = "runs/"
    }
    expiration {
      days = 7
    }
  }
}

output "bucket" {
  value = aws_s3_bucket.training.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.training.arn
}
