data "aws_availability_zones" "available" { state = "available" }
locals {
  name = "${var.project}-${var.environment}"
  tags = { Project = var.project, Environment = var.environment, ManagedBy = "Terraform" }
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr
  enable_dns_support = true
  enable_dns_hostnames = true
  tags = merge(local.tags, { Name = local.name })
}
resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id
   tags = local.tags }
resource "aws_subnet" "public" {
  count = 2
  vpc_id = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = true
  tags = merge(local.tags, { Name = "${local.name}-public-${count.index + 1}" })
}
resource "aws_subnet" "private" {
  count = 2
  vpc_id = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  tags = merge(local.tags, { Name = "${local.name}-private-${count.index + 1}" })
}
resource "aws_route_table" "public" { vpc_id = aws_vpc.main.id
   tags = local.tags }
resource "aws_route" "internet" { route_table_id = aws_route_table.public.id
   destination_cidr_block = "0.0.0.0/0"
   gateway_id = aws_internet_gateway.main.id }
resource "aws_route_table_association" "public" { count = 2
   subnet_id = aws_subnet.public[count.index].id
   route_table_id = aws_route_table.public.id }

resource "aws_security_group" "alb" {
  name = "${local.name}-alb"
   description = "Public HTTPS entry"
   vpc_id = aws_vpc.main.id
  ingress { from_port = 443
   to_port = 443
   protocol = "tcp"
   cidr_blocks = ["0.0.0.0/0"] }
  egress { from_port = 0
   to_port = 0
   protocol = "-1"
   cidr_blocks = ["0.0.0.0/0"] }
  tags = local.tags
}
resource "aws_security_group" "api" {
  name = "${local.name}-api"
   description = "API only from ALB"
   vpc_id = aws_vpc.main.id
  ingress { from_port = 3000
   to_port = 3000
   protocol = "tcp"
   security_groups = [aws_security_group.alb.id] }
  egress { from_port = 0
   to_port = 0
   protocol = "-1"
   cidr_blocks = ["0.0.0.0/0"] }
  tags = local.tags
}
resource "aws_security_group" "data" {
  name = "${local.name}-data"
   description = "Postgres and Redis from API tasks only"
   vpc_id = aws_vpc.main.id
  ingress { from_port = 5432
   to_port = 5432
   protocol = "tcp"
   security_groups = [aws_security_group.api.id] }
  ingress { from_port = 6379
   to_port = 6379
   protocol = "tcp"
   security_groups = [aws_security_group.api.id] }
  egress { from_port = 0
   to_port = 0
   protocol = "-1"
   cidr_blocks = ["0.0.0.0/0"] }
  tags = local.tags
}

resource "aws_db_subnet_group" "main" { name = local.name
   subnet_ids = aws_subnet.private[*].id
   tags = local.tags }
resource "aws_db_instance" "main" {
  identifier = local.name
  engine = "postgres"
   engine_version = "16"
  instance_class = "db.t4g.micro"
  allocated_storage = 20
   max_allocated_storage = 100
  storage_type = "gp3"
   storage_encrypted = true
  db_name = var.database_name
   username = var.database_username
  manage_master_user_password = true
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.data.id]
  publicly_accessible = false
   multi_az = false
  backup_retention_period = 7
   deletion_protection = true
  auto_minor_version_upgrade = true
   skip_final_snapshot = false
  final_snapshot_identifier = "${local.name}-final"
  tags = local.tags
}
resource "aws_elasticache_subnet_group" "main" { name = local.name
   subnet_ids = aws_subnet.private[*].id }
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "${local.name} Redis cache"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_clusters   = 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  tags = local.tags
}

resource "aws_s3_bucket" "media" { bucket_prefix = "${local.name}-media-"
   force_destroy = false
   tags = local.tags }
resource "aws_s3_bucket_public_access_block" "media" { bucket = aws_s3_bucket.media.id
   block_public_acls = true
   block_public_policy = true
   ignore_public_acls = true
   restrict_public_buckets = true }
resource "aws_s3_bucket_versioning" "media" { bucket = aws_s3_bucket.media.id
   versioning_configuration { status = "Enabled" } }
resource "aws_s3_bucket_server_side_encryption_configuration" "media" { bucket = aws_s3_bucket.media.id
   rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } } }
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter { prefix = "private-media/" }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["POST", "GET", "HEAD"]
    allowed_origins = [var.web_origin]
    expose_headers = ["ETag"]
    max_age_seconds = 3000
  }
}
resource "aws_cloudfront_origin_access_control" "media" { name = "${local.name}-media"
   description = "Private media bucket"
   origin_access_control_origin_type = "s3"
   signing_behavior = "always"
   signing_protocol = "sigv4" }
resource "aws_cloudfront_distribution" "media" {
  enabled = true
   comment = "${local.name} private-origin media"
   default_root_object = ""
  origin { domain_name = aws_s3_bucket.media.bucket_regional_domain_name
   origin_id = "media-s3"
   origin_access_control_id = aws_cloudfront_origin_access_control.media.id }
  default_cache_behavior { allowed_methods = ["GET", "HEAD", "OPTIONS"]
   cached_methods = ["GET", "HEAD"]
   target_origin_id = "media-s3"
   viewer_protocol_policy = "redirect-to-https"
   compress = true
   forwarded_values { query_string = false
   cookies { forward = "none" } } }
  restrictions { geo_restriction { restriction_type = "none" } }
  viewer_certificate { cloudfront_default_certificate = true }
  tags = local.tags
}
resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  # The old `users/` prefix remains reachable through CloudFront for existing public URLs.
  # New private uploads use `private-media/` and are never readable through this distribution.
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Sid = "AllowLegacyCloudFrontRead", Effect = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject", Resource = "${aws_s3_bucket.media.arn}/users/*", Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media.arn } } }] })
  depends_on = [aws_s3_bucket_public_access_block.media]
}

resource "aws_ecr_repository" "api" { name = "${local.name}-api"
   image_tag_mutability = "IMMUTABLE"
   image_scanning_configuration { scan_on_push = true }
   encryption_configuration { encryption_type = "AES256" }
   tags = local.tags }
resource "aws_ecs_cluster" "main" { name = local.name
   setting { name = "containerInsights"
   value = "enabled" }
   tags = local.tags }
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = local.tags
}
resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
resource "aws_iam_role_policy" "execution_secrets" {
  name = "${local.name}-inject-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.jwt_access_secret_arn, var.jwt_refresh_secret_arn, var.smtp_user_secret_arn, var.smtp_password_secret_arn, var.email_code_pepper_secret_arn, aws_db_instance.main.master_user_secret[0].secret_arn] }] })
}
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  tags               = local.tags
}
resource "aws_iam_role_policy" "task" {
  name = "${local.name}-runtime"
  role = aws_iam_role.task.id
  # Actions were confirmed by IAM Policy Autopilot against main.ts and media.controller.ts.
  # Resource ARNs are narrowed here to the resources created by this stack.
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.media.arn}/private-media/*" }, { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_db_instance.main.master_user_secret[0].secret_arn }] })
}
resource "aws_cloudwatch_log_group" "api" { name="/ecs/${local.name}/api"
   retention_in_days=30
   tags=local.tags }
resource "aws_lb" "api" { name=local.name
   load_balancer_type="application"
   internal=false
   subnets=aws_subnet.public[*].id
   security_groups=[aws_security_group.alb.id]
   tags=local.tags }
resource "aws_lb_target_group" "api" { name="${local.name}-api"
   port=3000
   protocol="HTTP"
   vpc_id=aws_vpc.main.id
   target_type="ip"
   health_check { path="/api/health"
   healthy_threshold=2
   unhealthy_threshold=3
   interval=30 }
   tags=local.tags }
resource "aws_lb_listener" "https" { load_balancer_arn=aws_lb.api.arn
   port=443
   protocol="HTTPS"
   certificate_arn=var.certificate_arn
   ssl_policy="ELBSecurityPolicy-TLS13-1-2-2021-06"
   default_action { type="forward"
   target_group_arn=aws_lb_target_group.api.arn } }
resource "aws_ecs_task_definition" "api" {
  family="${local.name}-api"
   requires_compatibilities=["FARGATE"]
   network_mode="awsvpc"
   cpu=var.api_cpu
   memory=var.api_memory
  execution_role_arn=aws_iam_role.execution.arn
   task_role_arn=aws_iam_role.task.arn
  container_definitions=jsonencode([{name="api",image=var.api_image,essential=true,portMappings=[{containerPort=3000,protocol="tcp"}],environment=[{name="NODE_ENV",value="production"},{name="WEB_ORIGIN",value=var.web_origin},{name="S3_BUCKET",value=aws_s3_bucket.media.bucket},{name="MEDIA_PUBLIC_BASE_URL",value="https://${aws_cloudfront_distribution.media.domain_name}"},{name="AWS_REGION",value=var.aws_region},{name="AWS_DB_SECRET_ARN",value=aws_db_instance.main.master_user_secret[0].secret_arn},{name="DB_HOST",value=aws_db_instance.main.address},{name="DB_NAME",value=var.database_name},{name="DB_PORT",value="5432"},{name="REDIS_URL",value="rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:${aws_elasticache_replication_group.redis.port}"},{name="SMTP_HOST",value="smtp.gmail.com"},{name="SMTP_PORT",value="465"},{name="SMTP_SECURE",value="true"},{name="SMTP_FROM",value=var.smtp_from},{name="SMTP_FROM_NAME",value="gloomi"}],secrets=[{name="JWT_ACCESS_SECRET",valueFrom=var.jwt_access_secret_arn},{name="JWT_REFRESH_SECRET",valueFrom=var.jwt_refresh_secret_arn},{name="SMTP_USER",valueFrom=var.smtp_user_secret_arn},{name="SMTP_PASSWORD",valueFrom=var.smtp_password_secret_arn},{name="EMAIL_CODE_PEPPER",valueFrom=var.email_code_pepper_secret_arn}],logConfiguration={logDriver="awslogs",options={"awslogs-group"=aws_cloudwatch_log_group.api.name,"awslogs-region"=var.aws_region,"awslogs-stream-prefix"="api"}}}])
  depends_on=[aws_iam_role_policy_attachment.execution, aws_iam_role_policy.execution_secrets]
}
resource "aws_ecs_service" "api" {
  name="api"
   cluster=aws_ecs_cluster.main.id
   task_definition=aws_ecs_task_definition.api.arn
   desired_count=1
   launch_type="FARGATE"
   health_check_grace_period_seconds=60
  network_configuration { subnets=aws_subnet.public[*].id
   security_groups=[aws_security_group.api.id]
   assign_public_ip=true }
  load_balancer { target_group_arn=aws_lb_target_group.api.arn
   container_name="api"
   container_port=3000 }
  depends_on=[aws_lb_listener.https]
  tags=local.tags
}
