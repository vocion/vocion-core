# Vocion AWS deploy — outputs.

output "public_ip" {
  description = "Elastic IP attached to the Vocion EC2. Use for DNS + SSH."
  value       = aws_eip.app.public_ip
}

output "url" {
  description = "Primary URL (DNS + TLS provisioning takes ~5 min after apply)."
  value       = "https://${var.apex_domain}"
}

output "ssh_command" {
  description = "SSH into the box (assumes ~/.ssh/<key_name>.pem)."
  value       = "ssh -i ~/.ssh/${var.key_name}.pem ec2-user@${aws_eip.app.public_ip}"
}

output "instance_id" {
  description = "EC2 instance id."
  value       = aws_instance.app.id
}

output "secret_arn" {
  description = "Secrets Manager secret holding the .env.production payload."
  value       = aws_secretsmanager_secret.production.arn
}

output "data_volume_id" {
  description = "EBS data volume id (mounted at /opt/vocion-data)."
  value       = aws_ebs_volume.data.id
}
