import type {
  ArchiveResult,
  ExtractorMeta,
  SearchResult,
  Snapshot,
  SnapshotDetail,
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
  created_at?: string;
  createdAt?: string;
}

export interface RawSnapshotDetail {
  id: number;
  url: string;
  status: SnapshotStatus;
  createdAt: string;
  extractors?: string[];
  tags?: RawTag[];
  archiveResults: RawArchiveResult[];
  title?: string | null;
  excerpt?: string | null;
  screenshotUrl?: string | null;
  extractorMeta?: Record<string, ExtractorMeta>;
}

export function toTag(r: RawTag): Tag {
  return { id: r.id, name: r.name, slug: r.slug, color: r.color, createdAt: r.createdAt };
}

function toArchiveResult(r: RawArchiveResult): ArchiveResult {
  return {
    id: r.id,
    extractor: r.extractor,
    content: r.content,
    createdAt: r.created_at ?? r.createdAt ?? "",
  };
}

export function toSnapshot(raw: RawSnapshot): Snapshot {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    screenshotUrl: raw.screenshotUrl ?? null,
  };
}

export function toSearchResult(raw: RawSearchResult): SearchResult {
  return {
    id: raw.id,
    url: raw.url,
    snippet: raw.snippet,
    rank: raw.rank,
    status: raw.status ?? null,
    createdAt: raw.createdAt ?? "",
    title: raw.title ?? null,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
  };
}

export function toSnapshotDetail(raw: RawSnapshotDetail): SnapshotDetail {
  return {
    id: raw.id,
    url: raw.url,
    status: raw.status,
    createdAt: raw.createdAt,
    extractors: raw.extractors ?? [],
    tags: (raw.tags ?? []).map(toTag),
    archiveResults: raw.archiveResults.map(toArchiveResult),
    title: raw.title ?? null,
    excerpt: raw.excerpt ?? null,
    screenshotUrl: raw.screenshotUrl ?? null,
    extractorMeta: raw.extractorMeta ?? {},
  };
}
