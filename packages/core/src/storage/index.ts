export type { StorageBackend } from "./interface";
export { FilesystemBackend } from "./filesystem";
export { S3Backend, validateS3Ref } from "./s3";
export type { S3Config } from "./s3";

import { join } from "node:path";
import { FilesystemBackend } from "./filesystem";
import type { StorageBackend } from "./interface";
import { S3Backend } from "./s3";

/**
 * Create a StorageBackend from environment variables.
 *
 * WEBFROST_STORAGE_BACKEND=filesystem (default) | s3
 *
 * S3 env vars (required when backend=s3):
 *   S3_ENDPOINT     — e.g. http://localhost:9000 or https://s3.amazonaws.com
 *   S3_BUCKET       — bucket name
 *   S3_ACCESS_KEY_ID       — access key ID
 *   S3_SECRET_ACCESS_KEY   — secret access key
 *   S3_REGION       — region (default: us-east-1)
 *   S3_PATH_PREFIX  — object key prefix (default: snapshots)
 */
export function createStorageBackend(webfrostDir: string): StorageBackend {
  const backend = process.env.WEBFROST_STORAGE_BACKEND ?? "filesystem";

  if (backend === "s3") {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET;
    const accessKey = process.env.S3_ACCESS_KEY_ID;
    const secretKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!endpoint || !bucket || !accessKey || !secretKey) {
      throw new Error(
        "S3 storage backend requires S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY",
      );
    }

    return new S3Backend({
      endpoint,
      bucket,
      accessKey,
      secretKey,
      ...(process.env.S3_REGION ? { region: process.env.S3_REGION } : {}),
      ...(process.env.S3_PATH_PREFIX ? { pathPrefix: process.env.S3_PATH_PREFIX } : {}),
    });
  }

  return new FilesystemBackend(join(webfrostDir, "snapshots"));
}
