# modules/vocion-stack — the media bucket.
#
# Core's media store writes recordings and their narrated versions here when
# VOCION_MEDIA_BUCKET is set (the module sets it), and serves each file as a
# redirect to a presigned GET that lasts minutes
# (packages/core/src/libs/tools/artifacts/media.ts). Nothing in the bucket is
# ever public: the box's role reads and writes it, browsers fetch presigned
# URLs cross-origin from the app's pages.

resource "aws_s3_bucket" "media" {
  bucket = local.media_bucket_name

  tags = { Name = local.media_bucket_name }
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# A deleted or overwritten recording stays recoverable for 30 days.
resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "expire-noncurrent"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.media]
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = local.media_cors_origins
    allowed_headers = ["Range"]
    expose_headers  = ["Content-Range", "Content-Length", "Accept-Ranges", "ETag"]
    max_age_seconds = 3600
  }
}

data "aws_iam_policy_document" "media_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket = aws_s3_bucket.media.id
  policy = data.aws_iam_policy_document.media_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.media]
}

data "aws_iam_policy_document" "media_rw" {
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.media.arn]
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
}

resource "aws_iam_role_policy" "media" {
  name   = "${var.name_prefix}-media"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.media_rw.json
}
