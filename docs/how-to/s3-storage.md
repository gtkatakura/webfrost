# How-to: S3 Storage

> **Status: coming soon.** S3/remote storage backend is on the roadmap and not yet available. This page will be updated when the feature ships.
>
> See [ROADMAP.md](../../ROADMAP.md) for status.

---

## Current storage model

Today WebFrost stores all archive files on the local filesystem inside `WEBFROST_DIR`. The SQLite database (`archive.db`) lives in the same directory.

For the storage layout and design rationale, see [Explanation: Storage model](../explanation/storage-model.md).

---

## When S3 support ships

Once the S3 backend lands, you will configure it via environment variables:

```bash
WEBFROST_STORAGE_BACKEND=s3
WEBFROST_S3_BUCKET=my-archive-bucket
WEBFROST_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

The SQLite database will remain local. Only archive files (WARC, PDF, screenshot, etc.) will be stored on S3.

This page will be updated with full configuration details and migration steps when the feature is released.
