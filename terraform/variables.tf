variable "github_org" {
  description = "GitHub organization name"
  type        = string
  default     = "suzuka-kosen-festa"
}

variable "github_app_id" {
  description = "GitHub App ID"
  type        = string
}

variable "github_app_installation_id" {
  description = "GitHub App Installation ID"
  type        = string
}

variable "github_app_pem_file" {
  description = "GitHub App private key (PEM format, file path or contents)"
  type        = string
  sensitive   = true
}
