output "api_base_url" { value = "https://${var.api_hostname}" }
output "load_balancer_dns" { value = aws_lb.api.dns_name }
output "media_bucket" { value = aws_s3_bucket.media.bucket }
output "media_cdn_domain" { value = aws_cloudfront_distribution.media.domain_name }
output "ecr_repository_url" { value = aws_ecr_repository.api.repository_url }
output "database_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
output "jwt_access_secret_arn" { value = var.jwt_access_secret_arn }
