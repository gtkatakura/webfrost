import type {
  ArchiveResult,
  ExtractorMeta,
  SearchResult,
  Snapshot,
  SnapshotDetail,
  SnapshotFailure,
  SnapshotStatus,
  Tag,
} from "./types.js";

// Raw server shapes. The server may omit fields older versions did not have; the mappers
// normalise them so the public types are always complete.

export interface RawTag {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  createdAt: string;
}

export interface RawSnapshot {
  id: number;
  url: string;
  status: SnapshotStatus;
  failure?: SnapshotFailure | null;
  createdAt: string;
  extractors: string[];
  tags: RawTag[];
  title: string | null;
  excerpt: string | null;
  screenshotUrl: string | null;
}

export interface RawSearchResult {
  id: number;
  url: string;
  snippet: string;
  rank: number;
  status?: SnapshotStatus;
  createdAt?: string;
  title?: string | null;
  extractors?: string[];
  tags?: RawTag[];
}

export interface RawArchiveResult {
  id: number;
  extractor: string;
  content: string | null;
  downloadUrl: string;
  previewUrl?: string | null;
  createdAt: string;
}

export interface RawSnapshotDetail {
  id: number;
  url: string;
  status: SnapshotStatus;
  failure?: SnapshotFailure | null;
  createdAt: string;
  extractors?: string[];
  tags?: RawTag[];
  archiveResults: RawArchiveResult[];
  title?: string | null;
  excerpt?: string | null;
  screenshotUrl?: string | null;
  extractorMeta?: Record<string, ExtractorMeta>;
}

/**
 * Turns a server-relative path ("/api/v1/...") into a URL under the client's base URL, so it
 * keeps working when the server sits below a reverse-proxy path or on another origin.
 */
export type ResolveUrl = (path: string) => string;

export function toTag(r: RawTag): Tag {
  return { id: r.id, name: r.name, slug: r.slug, color: r.color, createdAt: r.createdAt };
}

function toArchiveResult(r: RawArchiveResult, resolve: ResolveUrl): ArchiveResult {
  return {
    id: r.id,
    extractor: r.extractor,
    content: r.content,
    downloadUrl: resolve(r.downloadUrl),
    previewUrl: r.previewUrl ? resolve(r.previewUrl) : null,
    createdAt: r.createdAt,
  };
}

export function toSnapshot(raw: RawSnapshot, resolve: ResolveUrl): Snapshot {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    failure: raw.failure ?? null,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    screenshotUrl: raw.screenshotUrl ? resolve(raw.screenshotUrl) : null,
  };
}

export function toSearchResult(raw: RawSearchResult): SearchResult {
  return {
    id: raw.id,
    url: raw.url,
    snippet: raw.snippet ?? "",
    rank: raw.rank ?? 0,
    status: raw.status ?? null,
    createdAt: raw.createdAt ?? "",
    title: raw.title ?? null,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
  };
}

export function toSnapshotDetail(raw: RawSnapshotDetail, resolve: ResolveUrl): SnapshotDetail {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    failure: raw.failure ?? null,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
    archiveResults: raw.archiveResults.map((r) => toArchiveResult(r, resolve)),
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    screenshotUrl: raw.screenshotUrl ? resolve(raw.screenshotUrl) : null,
    extractorMeta: raw.extractorMeta ?? {},
  };
}
