variable "aws_region" {
  type    = string
  default = "eu-central-1"
}
variable "project" {
  type    = string
  default = "gloomi"
}
variable "environment" {
  type    = string
  default = "dev"
}
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "web_origin" {
  type        = string
  description = "Exact HTTPS browser origin allowed to call the API"
}
variable "api_image" {
  type        = string
  description = "Immutable ECR image URI including tag or digest"
}
variable "certificate_arn" {
  type        = string
  description = "ACM certificate in the same region for the API hostname"
}
variable "api_hostname" {
  type        = string
  description = "DNS name routed to the load balancer"
}
variable "database_name" {
  type    = string
  default = "gloomi"
}
variable "database_username" {
  type    = string
  default = "gloomi_admin"
}
variable "api_cpu" {
  type    = number
  default = 512
}
variable "api_memory" {
  type    = number
  default = 1024
}
variable "jwt_access_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing JWT_ACCESS_SECRET"
}
variable "jwt_refresh_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing JWT_REFRESH_SECRET"
}
variable "smtp_user_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing SMTP_USER"
}
variable "smtp_password_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing SMTP_PASSWORD"
}
variable "email_code_pepper_secret_arn" {
  type        = string
  description = "Secrets Manager ARN containing EMAIL_CODE_PEPPER"
}
variable "smtp_from" {
  type        = string
  description = "Verified Gmail mailbox address"
}
