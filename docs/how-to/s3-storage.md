# How-to: S3 Storage

WebFrost can store archive files in S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, Backblaze B2, and similar) instead of the local filesystem. The SQLite database (`archive.db`) always stays local in `WEBFROST_DIR` and holds metadata plus references to the stored files.

For the storage layout and design rationale, see [Explanation: Storage model](../explanation/storage-model.md). For provider endpoints and a local MinIO setup, see [Storage backends](/guides/storage-backends).

---

## Configure S3

Set `WEBFROST_STORAGE_BACKEND=s3` and the S3 variables before starting the server (or running the CLI):

```bash
WEBFROST_STORAGE_BACKEND=s3
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=my-webfrost-bucket
S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_REGION=us-east-1
S3_PATH_PREFIX=snapshots
```

| Variable | Default | Description |
|---|---|---|
| `WEBFROST_STORAGE_BACKEND` | `filesystem` | `filesystem` or `s3`. |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL. Required when `s3`. |
| `S3_BUCKET` | — | Bucket name. Required when `s3`. |
| `S3_ACCESS_KEY_ID` | — | Access key ID. Required when `s3`. |
| `S3_SECRET_ACCESS_KEY` | — | Secret access key. Required when `s3`. |
| `S3_REGION` | `us-east-1` | Bucket region. |
| `S3_PATH_PREFIX` | `snapshots` | Object key prefix inside the bucket. |

If `WEBFROST_STORAGE_BACKEND=s3` is set and any of the four required variables is missing, archiving fails with an error naming them.

Files are stored at `<S3_PATH_PREFIX>/<snapshot-id>/<filename>`, for example `snapshots/42/screenshot.png`.

With Docker Compose, put the same variables in `.env`; `docker-compose.prod.yml` passes them through.

## Downloads

For file extractors (PDF, screenshot, WARC, media, and so on) the server answers `GET /api/snapshots/:id/archives/:extractor/download` with a `302` redirect to a presigned S3 URL (valid for one hour) instead of streaming the file.

## Existing archives

Switching the backend does not move files that are already stored. Snapshots archived on the filesystem keep references to local files, so keep `WEBFROST_DIR` intact (or archive to S3 only from now on) rather than flipping the variable on a populated archive.

## Backups

Back up `archive.db` (see [Disk layout](/reference/disk-layout)) in addition to the bucket: the database is what maps snapshots to their files.
