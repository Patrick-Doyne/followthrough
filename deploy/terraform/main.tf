# One GPU instance running the whole FollowThrough stack in a container
# (deploy/docker), built up and torn down as a unit so it costs nothing
# between sessions:
#
#   cd deploy/terraform
#   terraform init
#   terraform apply            # ~2 min for the instance, then 30-45 min of image build on it
#   terraform output           # ssh command, how to read the public address
#   terraform destroy          # everything, including the disk; the ECR image survives
#
# The instance pulls the image from the ECR repository this creates; when
# it is not there yet (the first apply, or after a code change pushed with a
# new tag) it builds the image from the repository checkout and pushes it,
# so the next apply skips the build.
#
# Needs: an AWS profile with permission for EC2, VPC security groups, IAM
# roles and ECR; a GPU-instance quota ("Running On-Demand G and VT
# instances") of at least the instance's vCPUs in the region; the SSH public
# key below.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# --- inputs -------------------------------------------------------------------

variable "region" {
  description = "AWS region. Virginia is closest to the courts."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "GPU instance. g6e.xlarge (L40S) is the closest to the RTX 3090 the numbers were measured on; g5.xlarge (A10G) is cheaper and slower."
  type        = string
  default     = "g6e.xlarge"
}

variable "public_key_path" {
  description = "SSH public key installed on the instance (ssh-keygen -t ed25519 -f ~/.ssh/followthrough-ec2)."
  type        = string
  default     = "~/.ssh/followthrough-ec2.pub"
}

variable "ssh_cidr" {
  description = "Who may SSH in. Narrow it to your own address (e.g. 203.0.113.4/32)."
  type        = string
  default     = "0.0.0.0/0"
}

variable "repo_url" {
  description = "Repository the instance clones and builds."
  type        = string
  default     = "https://github.com/Patrick-Doyne/followthrough.git"
}

variable "repo_ref" {
  description = "Branch, tag or commit to deploy."
  type        = string
  default     = "main"
}

variable "image_tag" {
  description = "Tag of the image in ECR. Change it to force a rebuild from the checkout after a code change."
  type        = string
  default     = "v1"
}

variable "subnet_id" {
  description = "Subnet (and so availability zone) to launch in. Empty picks the first default subnet; set it when a zone has no g6e capacity (InsufficientInstanceCapacity), which happens."
  type        = string
  default     = ""
}

variable "root_volume_gb" {
  description = "Root disk. The image is about 12 GB; recordings and the build cache need room."
  type        = number
  default     = 150
}

# --- the AMI: AWS's Deep Learning Base image, which carries the NVIDIA
# driver, Docker and the NVIDIA container toolkit -------------------------------

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

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# --- network -------------------------------------------------------------------

resource "aws_security_group" "followthrough" {
  name        = "followthrough-monolith"
  description = "SSH, and UDP for WebRTC media. HTTPS arrives through the tunnel, which dials out."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  ingress {
    description = "WebRTC media and ICE (random UDP ports)"
    from_port   = 1024
    to_port     = 65535
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "followthrough-monolith" }
}

resource "aws_key_pair" "followthrough" {
  key_name   = "followthrough-ec2"
  public_key = file(pathexpand(var.public_key_path))
}

# --- the image store, so a rebuilt instance pulls instead of building -----------

resource "aws_ecr_repository" "followthrough" {
  name                 = "followthrough"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_iam_role" "instance" {
  name = "followthrough-monolith-instance"
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
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser"
}

resource "aws_iam_instance_profile" "instance" {
  name = "followthrough-monolith-instance"
  role = aws_iam_role.instance.name
}

# --- the instance ---------------------------------------------------------------

resource "aws_instance" "followthrough" {
  ami                         = data.aws_ami.dlami.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id != "" ? var.subnet_id : data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.followthrough.id]
  key_name                    = aws_key_pair.followthrough.key_name
  iam_instance_profile        = aws_iam_instance_profile.instance.name
  associate_public_ip_address = true

  root_block_device {
    volume_size = var.root_volume_gb
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    repo_url  = var.repo_url
    repo_ref  = var.repo_ref
    ecr_url   = aws_ecr_repository.followthrough.repository_url
    image_tag = var.image_tag
    region    = var.region
  })
  user_data_replace_on_change = true

  tags = { Name = "followthrough-monolith" }
}

resource "aws_eip" "followthrough" {
  instance = aws_instance.followthrough.id
  domain   = "vpc"
  tags     = { Name = "followthrough-monolith" }
}

# --- outputs --------------------------------------------------------------------

output "public_ip" {
  value = aws_eip.followthrough.public_ip
}

output "ssh" {
  value = "ssh -i ${replace(var.public_key_path, ".pub", "")} ubuntu@${aws_eip.followthrough.public_ip}"
}

output "setup_log" {
  description = "Follow the image build and start-up (30-45 min on the first apply)."
  value       = "ssh -i ${replace(var.public_key_path, ".pub", "")} ubuntu@${aws_eip.followthrough.public_ip} tail -f /var/log/followthrough-setup.log"
}

output "public_origin" {
  description = "The https address for the phone, once the container is up."
  value       = "ssh -i ${replace(var.public_key_path, ".pub", "")} ubuntu@${aws_eip.followthrough.public_ip} 'sudo docker exec followthrough cat /var/log/followthrough/public-origin'"
}

output "ecr_repository" {
  value = aws_ecr_repository.followthrough.repository_url
}

output "ami" {
  value = "${data.aws_ami.dlami.name} (${data.aws_ami.dlami.id})"
}
