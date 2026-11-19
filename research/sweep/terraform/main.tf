# The sweep machines: two Auto Scaling groups of g5.xlarge instances, one
# spot and one on-demand, each running the sweep worker (../worker.py) from
# the image in ECR. Only g5.xlarge (A10G): latency is compared across runs,
# so every run must be on the same GPU type: the g5.xlarge (A10G) chosen to
# define real time for the study.
# Workers coordinate through the training bucket (research/training/terraform/storage),
# so nothing here knows about runs.
#
#   terraform init
#   terraform apply                                   # groups at 0; ECR repo for the image
#   terraform apply -var spot=2 -var on_demand=2      # start the workers
#   terraform apply -var spot=0 -var on_demand=0      # stop them (results stay in S3)
#   terraform destroy                                 # everything here, not the bucket

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

variable "spot" {
  description = "Spot workers to run (each 4 vCPUs against the spot G-instance quota)."
  type        = number
  default     = 0
}

variable "on_demand" {
  description = "On-demand workers to run (each 4 vCPUs against the on-demand G-instance quota)."
  type        = number
  default     = 0
}

variable "instance_types" {
  description = "The one GPU type every run is measured on (A10G)."
  type        = list(string)
  default     = ["g5.xlarge"]
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "ssh_cidr" {
  description = "Who may SSH in to debug a worker, or empty for nobody."
  type        = string
  default     = ""
}

variable "public_key_path" {
  type    = string
  default = "~/.ssh/followthrough-ec2.pub"
}

provider "aws" {
  region = var.region
}

data "terraform_remote_state" "storage" {
  backend = "local"
  config = {
    path = "${path.module}/../../training/terraform/storage/terraform.tfstate"
  }
}

locals {
  bucket     = data.terraform_remote_state.storage.outputs.bucket
  bucket_arn = data.terraform_remote_state.storage.outputs.bucket_arn
}

data "aws_ami" "dlami" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["Deep Learning Base OSS Nvidia Driver GPU AMI (Ubuntu 24.04)*"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

data "aws_vpc" "default" {
  default = true
}

# Every default subnet in a zone that offers the instance types.
data "aws_ec2_instance_type_offerings" "gpu" {
  location_type = "availability-zone"
  filter {
    name   = "instance-type"
    values = var.instance_types
  }
}

data "aws_subnets" "gpu" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "availability-zone"
    values = distinct(data.aws_ec2_instance_type_offerings.gpu.locations)
  }
}

# --- the image -----------------------------------------------------------------

resource "aws_ecr_repository" "sweep" {
  name                 = "followthrough-sweep"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

# --- network: workers only call out (S3, ECR); SSH optionally ---------------

resource "aws_security_group" "worker" {
  name        = "followthrough-sweep"
  description = "FollowThrough sweep workers"
  vpc_id      = data.aws_vpc.default.id

  dynamic "ingress" {
    for_each = var.ssh_cidr == "" ? [] : [var.ssh_cidr]
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_key_pair" "worker" {
  key_name   = "followthrough-sweep"
  public_key = file(pathexpand(var.public_key_path))
}

# --- what a worker may do: the bucket, and pulling its image ------------------

resource "aws_iam_role" "worker" {
  name = "followthrough-sweep"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "bucket" {
  role = aws_iam_role.worker.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.bucket_arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.bucket_arn}/*"
      },
    ]
  })
}

resource "aws_iam_instance_profile" "worker" {
  name = "followthrough-sweep"
  role = aws_iam_role.worker.name
}

# --- the machines ----------------------------------------------------------------

resource "aws_launch_template" "worker" {
  name_prefix = "followthrough-sweep-"
  image_id    = data.aws_ami.dlami.id
  key_name    = aws_key_pair.worker.key_name
  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    region = var.region
    image  = "${aws_ecr_repository.sweep.repository_url}:${var.image_tag}"
    bucket = local.bucket
  }))
  vpc_security_group_ids = [aws_security_group.worker.id]

  iam_instance_profile {
    arn = aws_iam_instance_profile.worker.arn
  }

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size           = 150
      volume_type           = "gp3"
      delete_on_termination = true
    }
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "followthrough-sweep" }
  }
}

resource "aws_autoscaling_group" "spot" {
  name = "followthrough-sweep-spot"
  # GPU capacity is often short; the group keeps trying on its own, so apply
  # returns at once instead of failing after its wait.
  wait_for_capacity_timeout = "0"
  min_size                  = 0
  max_size                  = 2
  desired_capacity          = var.spot
  vpc_zone_identifier       = data.aws_subnets.gpu.ids
  capacity_rebalance        = true

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 0
      on_demand_percentage_above_base_capacity = 0
      spot_allocation_strategy                 = "price-capacity-optimized"
    }
    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.worker.id
        version            = "$Latest"
      }
      dynamic "override" {
        for_each = var.instance_types
        content {
          instance_type = override.value
        }
      }
    }
  }
}

resource "aws_autoscaling_group" "on_demand" {
  name = "followthrough-sweep-on-demand"
  # GPU capacity is often short; the group keeps trying on its own, so apply
  # returns at once instead of failing after its wait.
  wait_for_capacity_timeout = "0"
  min_size                  = 0
  max_size                  = 2
  desired_capacity          = var.on_demand
  vpc_zone_identifier       = data.aws_subnets.gpu.ids

  mixed_instances_policy {
    instances_distribution {
      on_demand_base_capacity                  = 0
      on_demand_percentage_above_base_capacity = 100
      on_demand_allocation_strategy            = "prioritized"
    }
    launch_template {
      launch_template_specification {
        launch_template_id = aws_launch_template.worker.id
        version            = "$Latest"
      }
      dynamic "override" {
        for_each = var.instance_types
        content {
          instance_type = override.value
        }
      }
    }
  }
}

output "ecr_repository" {
  value = aws_ecr_repository.sweep.repository_url
}

output "bucket" {
  value = local.bucket
}
