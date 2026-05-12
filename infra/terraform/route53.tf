# Vocion AWS deploy — DNS.
#
# The hosted zone for vocion.ai already exists in the metacto account
# (id Z06298783TMOTVTWTEX01, provided 2026-05-12). We add two A records
# pointing at the Elastic IP.

resource "aws_route53_record" "apex" {
  zone_id = var.hosted_zone_id
  name    = var.apex_domain
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}

resource "aws_route53_record" "www" {
  count = var.www_subdomain == "" ? 0 : 1

  zone_id = var.hosted_zone_id
  name    = var.www_subdomain
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}
