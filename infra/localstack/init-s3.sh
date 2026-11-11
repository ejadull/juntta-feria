#!/bin/sh
set -eu

awslocal s3api head-bucket --bucket "${S3_BUCKET}" >/dev/null 2>&1 || \
  awslocal s3api create-bucket --bucket "${S3_BUCKET}" >/dev/null

# EXH-03: the browser PUTs/GETs documents straight to the bucket with presigned URLs.
awslocal s3api put-bucket-cors --bucket "${S3_BUCKET}" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:4200", "http://127.0.0.1:4200"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }]
}'
