terraform {
  required_version = ">= 1.0"

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.12"
    }
  }
}

locals {
  github_app_pem = fileexists(var.github_app_pem_file) ? file(var.github_app_pem_file) : var.github_app_pem_file
}

provider "github" {
  owner = var.github_org

  app_auth {
    id              = var.github_app_id
    installation_id = var.github_app_installation_id
    pem_file        = local.github_app_pem
  }
}
