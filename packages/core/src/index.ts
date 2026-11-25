// @webfrost/core — DB, pipeline, extractors
export { ConcurrencyLimiter, createConcurrencyLimiter } from "./concurrency";
export type { StorageBackend } from "./storage";
export { FilesystemBackend, S3Backend, createStorageBackend, validateS3Ref } from "./storage";
export type { S3Config } from "./storage";
export {
  closeDatabases,
  isTransientError,
  isUniqueViolation,
  openDb,
  parseDatabaseUrl,
  resolveDatabaseConfig,
  SCHEMA_VERSION,
} from "./db";
export type { DatabaseConfig, Db, DialectName } from "./db";
export { sql } from "kysely";
export {
  authenticateApiKey,
  createAdminUser,
  createApiKey,
  createSession,
  createSessionToken,
  getAdminUsername,
  hasAdminUser,
  listApiKeys,
  parseDbTimestamp,
  revokeAllSessions,
  revokeApiKey,
  revokeSession,
  updateAdminPassword,
  validateAdminCredentials,
  validateApiKey,
  verifySession,
  verifySessionToken,
} from "./auth";
export type { ApiKey, AuthenticatedApiKey } from "./auth";
export { FetchCache } from "./fetch-cache";
export type { CachedResponse } from "./fetch-cache";
export {
  ImportLimitError,
  detectFormat,
  importMaxBytes,
  importMaxUrls,
  importTooLargeMessage,
  importTooManyUrlsMessage,
  parseUrls,
} from "./import";
export type { ImportFormat } from "./import";
export { countImports, listImports, recordImport } from "./import-history";
export type { ImportRecord } from "./import-history";
export { fetchRssFeedUrls, isUrlArchived } from "./rss";
export {
  assertPublicUrl,
  fetchGuarded,
  isPrivateIPv4,
  isPrivateIPv6,
  safeFetch,
} from "./ssrf-guard";
export { ResponseTooLargeError } from "./ssrf-guard";
export type { FetchedResponse, GuardedFetchResult, SafeFetchOptions } from "./ssrf-guard";
export { webfrostDataDir } from "./data-dir";
export {
  cachedChromium,
  chromiumPointerFile,
  resolveChromium,
  systemChromiumCandidates,
  webfrostBrowsersDir,
  webfrostCacheDir,
} from "./chromium";
export type { ChromiumSource, ResolvedChromium } from "./chromium";
export { guardBrowserContext } from "./browser-guard";
export type { BrowserGuard, HostCheck } from "./browser-guard";
export { HostThrottle, domainThrottle } from "./throttle";
export { runProcess } from "./subprocess";
export type { ProcessResult, RunProcessOptions } from "./subprocess";
export { JobRunner } from "./jobs";
export {
  FAILURE_GROUPS,
  type FailedSnapshot,
  type FailureDomain,
  type FailureGroupId,
  type FailureGroupSummary,
  failureGroup,
  failureGroupSnapshotIds,
  groupOfCategory,
  listFailedSnapshots,
  listFailureDomains,
  summarizeFailureGroups,
} from "./failure-groups";
export {
  type TrashedSnapshot,
  deleteSnapshotsForever,
  listTrash,
  purgeExpiredTrash,
  restoreSnapshots,
  trashSnapshotIds,
  trashSnapshots,
  trashedIds,
} from "./trash";
export {
  SettingRangeError,
  TRASH_RETENTION_DAYS,
  getTrashRetentionDays,
  setTrashRetentionDays,
} from "./app-settings";
export {
  FAILURE_CATEGORIES,
  type Failure,
  type FailureCategory,
  type FailureClass,
  categorizeError,
  categorizeStatus,
  failureClass,
  isFailureCategory,
} from "./failure";
export {
  DEAD_HOST_TTL_SECONDS,
  forgetDeadHost,
  hostOf,
  knownDeadHost,
  markDeadHost,
} from "./dead-hosts";
export { DEFAULT_MIN_PAGE_TEXT, blockPageReason, redirectReason } from "./block-page";
export type { JobRunnerOptions } from "./jobs";
export { SCHEDULER_INTERVAL_MS, claimSchedule, runDueSchedules, startScheduler } from "./scheduler";
export type { Scheduler, SchedulerOptions } from "./scheduler";
export {
  getSnapshotsByIds,
  listSnapshots,
  listSnapshotsWithExtractors,
  listSnapshotsWithExtractorsPaginated,
} from "./list";
export type {
  Snapshot,
  SnapshotFilter,
  SnapshotWithExtractors,
  PaginatedResult,
} from "./list";
export {
  JOB_LEASE_SECONDS,
  addUrl,
  chromiumLaunchOptions,
  createSnapshot,
  type ColorScheme,
  type SnapshotOptions,
  createSnapshotJob,
  defaultColorScheme,
  parseColorScheme,
  runPipeline,
  withTimeout,
} from "./pipeline";
export type { Logger, PipelineOptions } from "./pipeline";
export { IMPORTING_STATUS, SnapshotBusyError, deleteSnapshot, getSnapshot } from "./snapshot";
export {
  BUNDLE_EXTRACTORS,
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  BundleError,
  ReplaceConflictError,
  BundleTooLargeError,
  DEFAULT_BUNDLE_MAX_BYTES,
  exportSnapshotBundle,
  importSnapshotBundle,
  parseManifest,
  planSnapshotBundle,
  snapshotBundleStream,
  spoolToTempFile,
  sweepStaleBundleUploads,
  sweepStaleImports,
} from "./bundle";
export type {
  BundleLimits,
  BundleManifest,
  BundlePlan,
  BundleResult,
  ImportedSnapshot,
} from "./bundle";
export type { SnapshotDetail } from "./snapshot";
export {
  addRssFeedSchedule,
  addSchedule,
  getSchedule,
  listSchedules,
  removeSchedule,
  getDueSchedules,
  markScheduleRun,
  pauseSchedule,
  updateScheduleStatus,
  dbTimestamp,
} from "./schedules";
export type { Schedule } from "./schedules";
export { CronError, nextCronDate, parseCron } from "./cron";
export {
  addTagToSnapshot,
  createTag,
  deleteTag,
  findTagByName,
  getOrCreateTag,
  getTag,
  InvalidTagNameError,
  listSnapshotTags,
  listTags,
  MAX_TAG_NAME_LENGTH,
  normalizeTagName,
  removeTagFromSnapshot,
  slugify,
  tagNameProblem,
} from "./tags";
export type { Tag } from "./tags";
export { indexSnapshot, rebuildIndex, removeFromIndex, searchSnapshots } from "./search";
export { recordResult, setJobStatus } from "./results";
export type { ResultRecord } from "./results";
export type { SearchResult } from "./search";
export {
  captureContext,
  emitTelemetryLog,
  failureCategory,
  initTelemetry,
  recordMetric,
  setTelemetryBackend,
  shutdownTelemetry,
  telemetryConfigured,
  telemetryEnabled,
  telemetryExportsLogs,
  traceLogFields,
  withSpan,
  withTraceContext,
} from "./telemetry";
export type {
  Attributes as TelemetryAttributes,
  InitTelemetryOptions,
  SpanHandle,
  SpanOptions,
  TelemetryBackend,
  TraceContext,
} from "./telemetry";
export { getStats } from "./stats";
export type { Stats } from "./stats";
export { ID_CHUNK, chunks } from "./chunks";
