import type { Generated } from "kysely";

/**
 * Table shapes, for Kysely's query builder. Timestamps are UTC text in
 * "YYYY-MM-DD HH:MM:SS" form on every dialect (what SQLite's datetime('now')
 * produces), so ordering and comparisons behave identically everywhere and the
 * API output does not change with the database.
 */
export interface Schema {
  snapshots: {
    id: Generated<number>;
    url: string;
    status: Generated<string>;
    created_at: Generated<string>;
    color_scheme: Generated<string | null>;
  };
  archive_results: {
    id: Generated<number>;
    snapshot_id: number;
    extractor: string;
    content: string | null;
    created_at: Generated<string>;
    duration_ms: number | null;
    error: string | null;
    size_bytes: number | null;
  };
  job_queue: {
    id: Generated<number>;
    snapshot_id: number;
    status: Generated<string>;
    created_at: Generated<string>;
    heartbeat_at: string | null;
    attempts: Generated<number>;
    lease_token: string | null;
  };
  schedules: {
    id: Generated<number>;
    url: string;
    cron: string;
    created_at: Generated<string>;
    last_run_at: string | null;
    next_run_at: string;
    kind: Generated<string>;
    paused: Generated<number>;
    last_status: string | null;
    consecutive_failures: Generated<number>;
  };
  tags: {
    id: Generated<number>;
    name: string;
    slug: string;
    color: string | null;
    created_at: Generated<string>;
  };
  snapshot_tags: {
    snapshot_id: number;
    tag_id: number;
  };
  admin_users: {
    id: Generated<number>;
    username: string;
    password_hash: string;
    created_at: Generated<string>;
  };
  api_keys: {
    id: string;
    name: string;
    key_hash: string;
    expires_at: string | null;
    last_used_at: string | null;
    revoked_at: string | null;
    created_at: Generated<string>;
  };
  imports: {
    id: string;
    source_url: string | null;
    format: string;
    queued: Generated<number>;
    skipped: Generated<number>;
    created_at: Generated<string>;
  };
  sessions: {
    id: string;
    username: string;
    created_at: Generated<string>;
    expires_at: string;
  };
}
