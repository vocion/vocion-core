# modules/vocion-stack — the edge: DNS, the ACM certificate, the ALB and the
# WAF in front of it.
#
# With alb_enabled (the default) TLS ends at the ALB, the WAF sees every
# request first, and the box serves plain HTTP to the ALB alone. Without it,
# the record points at the box and Caddy terminates TLS with Let's Encrypt,
# the way a single-box install of core always has.

# ----- certificate -----

resource "aws_acm_certificate" "app" {
  count = var.alb_enabled ? 1 : 0

  domain_name       = var.hostname
  validation_method = "DNS"

  tags = { Name = var.hostname }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for o in flatten(aws_acm_certificate.app[*].domain_validation_options) : o.domain_name => o
  }

  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  ttl             = 300
  records         = [each.value.resource_record_value]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "app" {
  count = var.alb_enabled ? 1 : 0

  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# ----- load balancer -----

resource "aws_security_group" "alb" {
  count = var.alb_enabled ? 1 : 0

  name        = "${var.name_prefix}-alb"
  description = "Vocion ALB - HTTP and HTTPS from anywhere"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name_prefix}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb" {
  for_each = var.alb_enabled ? toset(["80", "443"]) : toset([])

  security_group_id = aws_security_group.alb[0].id
  description       = each.key == "80" ? "HTTP (redirected to HTTPS)" : "HTTPS"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  count = var.alb_enabled ? 1 : 0

  security_group_id            = aws_security_group.alb[0].id
  description                  = "HTTP to the box"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_lb" "app" {
  count = var.alb_enabled ? 1 : 0

  name                       = substr("${var.name_prefix}-alb", 0, 32)
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb[0].id]
  subnets                    = aws_subnet.public[*].id
  idle_timeout               = var.alb_idle_timeout
  drop_invalid_header_fields = true
  enable_deletion_protection = var.db_deletion_protection

  # logging.tf. The ALB writes a test object when logs are turned on, so the
  # bucket policy has to exist first.
  dynamic "access_logs" {
    for_each = local.alb_access_logs_enabled ? [aws_s3_bucket.alb_logs[0].id] : []
    content {
      bucket  = access_logs.value
      prefix  = local.alb_access_logs_prefix
      enabled = true
    }
  }

  tags = { Name = "${var.name_prefix}-alb" }

  depends_on = [aws_s3_bucket_policy.alb_logs]
}

resource "aws_lb_target_group" "app" {
  count = var.alb_enabled ? 1 : 0

  name                 = substr("${var.name_prefix}-app", 0, 32)
  port                 = 80
  protocol             = "HTTP"
  target_type          = "instance"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30

  health_check {
    path                = var.health_check_path
    matcher             = "200-399"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group_attachment" "app" {
  count = var.alb_enabled ? 1 : 0

  target_group_arn = aws_lb_target_group.app[0].arn
  target_id        = aws_instance.app.id
  port             = 80
}

resource "aws_lb_listener" "http" {
  count = var.alb_enabled ? 1 : 0

  load_balancer_arn = aws_lb.app[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

# Only requests for the installation's own hostname reach the box; anything
# addressed to the ALB's own name or an IP gets a 404 at the edge.
resource "aws_lb_listener" "https" {
  count = var.alb_enabled ? 1 : 0

  load_balancer_arn = aws_lb.app[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = var.alb_ssl_policy
  certificate_arn   = aws_acm_certificate_validation.app[0].certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "app" {
  count = var.alb_enabled ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  condition {
    host_header {
      values = [var.hostname]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app[0].arn
  }
}

# ----- alias hostnames -----
#
# A hostname the installation used to serve, kept working after it moved here.
# A person's browser is sent to `hostname` with a 301 that keeps the path and
# query. `/api/*` is served in place instead: a webhook sender or API client
# configured with the old name keeps reaching the app, and a 301 would turn its
# POST into a GET. The alias's DNS lives wherever its zone is; point it at
# `alb_dns_name`.

resource "aws_lb_listener_certificate" "alias" {
  for_each = var.alb_enabled ? { for a in var.alias_hostnames : a.hostname => a } : {}

  listener_arn    = aws_lb_listener.https[0].arn
  certificate_arn = each.value.certificate_arn
}

resource "aws_lb_listener_rule" "alias_api" {
  count = var.alb_enabled && length(var.alias_hostnames) > 0 ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20

  condition {
    host_header {
      values = [for a in var.alias_hostnames : a.hostname]
    }
  }
  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app[0].arn
  }
}

resource "aws_lb_listener_rule" "alias_redirect" {
  count = var.alb_enabled && length(var.alias_hostnames) > 0 ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 30

  condition {
    host_header {
      values = [for a in var.alias_hostnames : a.hostname]
    }
  }

  action {
    type = "redirect"
    redirect {
      host        = var.hostname
      protocol    = "HTTPS"
      port        = "443"
      path        = "/#{path}"
      query       = "#{query}"
      status_code = "HTTP_301"
    }
  }
}

# ----- WAF -----

resource "aws_wafv2_web_acl" "app" {
  count = local.waf_enabled ? 1 : 0

  name        = "${var.name_prefix}-web"
  description = "Vocion ${var.environment}: AWS managed common + known-bad-inputs rules and a per-IP rate limit"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "aws-common"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        dynamic "rule_action_override" {
          for_each = toset(local.waf_count_rules)
          content {
            name = rule_action_override.value
            action_to_use {
              count {}
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-aws-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-aws-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 30

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-web"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "app" {
  count = local.waf_enabled ? 1 : 0

  resource_arn = aws_lb.app[0].arn
  web_acl_arn  = aws_wafv2_web_acl.app[0].arn
}

# ----- DNS -----

resource "aws_route53_record" "app_alias" {
  count = var.alb_enabled ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.hostname
  type    = "A"

  alias {
    name                   = aws_lb.app[0].dns_name
    zone_id                = aws_lb.app[0].zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "app_direct" {
  count = var.alb_enabled ? 0 : 1

  zone_id = var.route53_zone_id
  name    = var.hostname
  type    = "A"
  ttl     = 60
  records = [local.app_public_ip]
}
