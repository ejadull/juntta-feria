#!/bin/sh
set -eu

awslocal s3api head-bucket --bucket "${S3_BUCKET}" >/dev/null 2>&1 || \
  awslocal s3api create-bucket --bucket "${S3_BUCKET}" >/dev/null

