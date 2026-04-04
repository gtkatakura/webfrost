import { WebFrostError } from "@webfrost/sdk";
import type { SearchResult, Tag } from "@webfrost/sdk";
import { Bookmark, BookmarkCheck, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useClient } from "../context";
import { useSearch } from "../hooks/useSearch";

// ─── Saved searches ────────────────────────────────────────────────────────────

const SAVED_KEY = "webfrost-saved-searches";
const MAX_SAVED = 10;

interface SavedSearch {
  name: string;
  q: string;
}

function loadSaved(): SavedSearch[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as SavedSearch[];
  } catch {
    return [];
  }
}

function saveSaved(list: SavedSearch[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {}
}

// ─── Date presets ─────────────────────────────────────────────────────────────

const DATE_PRESETS = [
  { label: "Any time", days: null },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
] as const;

function dateFromDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_EXTRACTORS = ["warc", "readability", "pdf", "screenshot", "dom-snapshot"];
const STATUSES = ["done", "failed", "processing", "queued"] as const;

const statusColors: Record<string, string> = {
  done: "var(--status-success)",
  failed: "var(--status-danger)",
  processing: "var(--status-warning)",
  queued: "var(--status-pending)",
};

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        color: "var(--text-low)",
        marginBottom: 6,
        marginTop: 16,
      }}
    >
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  color,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 8px",
        borderRadius: 5,
        border: active
          ? `1px solid ${color ?? "var(--accent)"}`
          : "1px solid var(--border-default)",
        background: active
          ? `color-mix(in srgb, ${color ?? "var(--accent)"} 12%, transparent)`
          : "none",
        color: active ? (color ?? "var(--accent)") : "var(--text-mid)",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        transition: "all 120ms",
        whiteSpace: "nowrap",
      }}
    >
      {color && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </button>
  );
}

// ─── Search result card ────────────────────────────────────────────────────────

function ResultCard({ result }: { result: SearchResult }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/snapshots/${result.id}`)}
      style={{
        width: "100%",
        textAlign: "left",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: "12px 16px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        transition: "border-color 120ms, box-shadow 120ms",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
        (e.currentTarget as HTMLElement).style.boxShadow =
          "0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: "var(--accent)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {result.url}
      </div>
      {result.snippet && (
        <div
          style={{ fontSize: 12, color: "var(--text-mid)", lineHeight: 1.6 }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled server snippet with <mark> tags
          dangerouslySetInnerHTML={{ __html: result.snippet }}
        />
      )}
    </button>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function SearchPage() {
  const client = useClient();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const initialQ = params.get("q") ?? "";
  const [inputVal, setInputVal] = useState(initialQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync input with URL
  useEffect(() => {
    setInputVal(params.get("q") ?? "");
  }, [params]);

  function setQ(q: string) {
    setInputVal(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q.trim()) {
        next.set("q", q.trim());
      } else {
        next.delete("q");
      }
      setParams(next, { replace: true });
    }, 350);
  }

  const ftsQuery = params.get("q") ?? "";
  const { results: rawResults, loading } = useSearch(ftsQuery);

  // ── Sidebar filters state ─────────────────────────────────────────────────
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(new Set());
  const [activeDays, setActiveDays] = useState<number | null>(null);
  const [activeExtractors, setActiveExtractors] = useState<Set<string>>(new Set());
  const [activeTags, setActiveTags] = useState<Set<number>>(new Set());
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const loadTags = useCallback(async () => {
    try {
      const data = await client.listTags();
      setAllTags(data);
    } catch (e) {
      toast.error(e instanceof WebFrostError ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  // ── Snapshot metadata for filter cross-reference ──────────────────────────
  const [snapshotMeta, setSnapshotMeta] = useState<
    Map<number, { status: string; createdAt: string; extractors: string[]; tags: Tag[] }>
  >(new Map());

  const loadMeta = useCallback(async () => {
    if (rawResults.length === 0) return;
    try {
      const page = await client.listSnapshots({ limit: 100 });
      const map = new Map<
        number,
        { status: string; createdAt: string; extractors: string[]; tags: Tag[] }
      >();
      for (const s of page.items) {
        map.set(s.id, {
          status: s.status,
          createdAt: s.createdAt,
          extractors: s.extractors,
          tags: s.tags,
        });
      }
      setSnapshotMeta(map);
    } catch {
      // non-critical, filters just won't refine
    }
  }, [client, rawResults]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // ── Apply filters to FTS results ──────────────────────────────────────────
  const dateThreshold = activeDays ? dateFromDays(activeDays) : null;

  const results = useMemo(() => {
    if (
      activeStatuses.size === 0 &&
      activeDays === null &&
      activeExtractors.size === 0 &&
      activeTags.size === 0
    ) {
      return rawResults;
    }
    return rawResults.filter((r) => {
      const meta = snapshotMeta.get(r.id);
      if (!meta) return true; // no metadata to filter on yet

      if (activeStatuses.size > 0 && !activeStatuses.has(meta.status)) return false;
      if (dateThreshold && meta.createdAt < dateThreshold) return false;
      if (activeExtractors.size > 0) {
        for (const ext of activeExtractors) {
          if (!meta.extractors.includes(ext)) return false;
        }
      }
      if (activeTags.size > 0) {
        const tagIds = new Set(meta.tags.map((t) => t.id));
        for (const tid of activeTags) {
          if (!tagIds.has(tid)) return false;
        }
      }
      return true;
    });
  }, [
    rawResults,
    snapshotMeta,
    activeStatuses,
    activeDays,
    dateThreshold,
    activeExtractors,
    activeTags,
  ]);

  // ── Saved searches ────────────────────────────────────────────────────────
  const [saved, setSaved] = useState<SavedSearch[]>(loadSaved);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  const isSaved = saved.some((s) => s.q === ftsQuery);

  function handleSave() {
    if (!ftsQuery.trim()) return;
    if (isSaved) {
      const next = saved.filter((s) => s.q !== ftsQuery);
      setSaved(next);
      saveSaved(next);
      return;
    }
    setShowSaveInput(true);
    setSaveNameInput(ftsQuery);
  }

  function confirmSave() {
    const name = saveNameInput.trim() || ftsQuery;
    const next = [{ name, q: ftsQuery }, ...saved.filter((s) => s.q !== ftsQuery)].slice(
      0,
      MAX_SAVED,
    );
    setSaved(next);
    saveSaved(next);
    setShowSaveInput(false);
  }

  function removeSaved(q: string) {
    const next = saved.filter((s) => s.q !== q);
    setSaved(next);
    saveSaved(next);
  }

  function applySaved(s: SavedSearch) {
    navigate(`/search?q=${encodeURIComponent(s.q)}`);
  }

  const hasFilters =
    activeStatuses.size > 0 ||
    activeDays !== null ||
    activeExtractors.size > 0 ||
    activeTags.size > 0;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-app)" }}>
      {/* ── Sidebar filters ─────────────────────────────────────────────── */}
      <aside
        style={{
          width: 220,
          minWidth: 220,
          padding: "24px 16px",
          borderRight: "1px solid var(--border-default)",
          background: "var(--bg-surface)",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color: "var(--text-low)",
            marginBottom: 16,
          }}
        >
          Filters
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setActiveStatuses(new Set());
              setActiveDays(null);
              setActiveExtractors(new Set());
              setActiveTags(new Set());
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-low)",
              fontSize: 11,
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginBottom: 8,
            }}
          >
            <X size={10} />
            Clear all filters
          </button>
        )}

        {/* Status */}
        <SectionLabel>Status</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {STATUSES.map((s) => (
            <FilterChip
              key={s}
              active={activeStatuses.has(s)}
              color={statusColors[s]}
              onClick={() =>
                setActiveStatuses((prev) => {
                  const next = new Set(prev);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
            >
              {s}
            </FilterChip>
          ))}
        </div>

        {/* Date range */}
        <SectionLabel>Date</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {DATE_PRESETS.map(({ label, days }) => (
            <FilterChip
              key={label}
              active={activeDays === days}
              onClick={() => setActiveDays(days)}
            >
              {label}
            </FilterChip>
          ))}
        </div>

        {/* Extractors */}
        <SectionLabel>Has extractor</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {KNOWN_EXTRACTORS.map((ext) => (
            <FilterChip
              key={ext}
              active={activeExtractors.has(ext)}
              onClick={() =>
                setActiveExtractors((prev) => {
                  const next = new Set(prev);
                  if (next.has(ext)) next.delete(ext);
                  else next.add(ext);
                  return next;
                })
              }
            >
              {ext}
            </FilterChip>
          ))}
        </div>

        {/* Tags */}
        {allTags.length > 0 && (
          <>
            <SectionLabel>Tags</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {allTags.map((tag) => (
                <FilterChip
                  key={tag.id}
                  active={activeTags.has(tag.id)}
                  color={tag.color ?? undefined}
                  onClick={() =>
                    setActiveTags((prev) => {
                      const next = new Set(prev);
                      if (next.has(tag.id)) next.delete(tag.id);
                      else next.add(tag.id);
                      return next;
                    })
                  }
                >
                  {tag.name}
                </FilterChip>
              ))}
            </div>
          </>
        )}
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main style={{ flex: 1, padding: "24px 28px", minWidth: 0 }}>
        {/* Search input + save */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <Search size={15} style={{ color: "var(--text-low)", flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Search…"
              value={inputVal}
              onChange={(e) => setQ(e.target.value)}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontSize: 14,
                color: "var(--text-high)",
              }}
            />
            {inputVal && (
              <button
                type="button"
                onClick={() => setQ("")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-low)",
                  display: "flex",
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {ftsQuery && (
            <button
              type="button"
              onClick={handleSave}
              title={isSaved ? "Remove saved search" : "Save this search"}
              style={{
                background: isSaved
                  ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                  : "var(--bg-surface)",
                border: "1px solid var(--border-default)",
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                color: isSaved ? "var(--accent)" : "var(--text-mid)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
              {isSaved ? "Saved" : "Save"}
            </button>
          )}
        </div>

        {/* Save name input */}
        {showSaveInput && (
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 12,
              padding: "10px 12px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: 8,
            }}
          >
            <input
              type="text"
              placeholder="Name this search…"
              value={saveNameInput}
              onChange={(e) => setSaveNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSave();
                if (e.key === "Escape") setShowSaveInput(false);
              }}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                fontSize: 13,
                color: "var(--text-high)",
              }}
              // biome-ignore lint/a11y/noAutofocus: intentional focus for user confirmation
              autoFocus
            />
            <button
              type="button"
              onClick={confirmSave}
              style={{
                padding: "4px 10px",
                background: "var(--accent)",
                color: "var(--accent-fg)",
                border: "none",
                borderRadius: 5,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowSaveInput(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-low)",
                display: "flex",
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Saved searches chips */}
        {saved.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {saved.map((s) => (
              <span
                key={s.q}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px 3px 10px",
                  borderRadius: 20,
                  background:
                    s.q === ftsQuery
                      ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                      : "var(--bg-overlay)",
                  border:
                    s.q === ftsQuery
                      ? "1px solid color-mix(in srgb, var(--accent) 30%, transparent)"
                      : "1px solid var(--border-default)",
                  color: s.q === ftsQuery ? "var(--accent)" : "var(--text-mid)",
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                <button
                  type="button"
                  onClick={() => applySaved(s)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    color: "inherit",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => removeSaved(s.q)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    color: "var(--text-low)",
                    display: "flex",
                    marginLeft: 2,
                  }}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Results count */}
        {ftsQuery && !loading && (
          <div style={{ fontSize: 12, color: "var(--text-low)", marginBottom: 14 }}>
            {results.length === 0
              ? "No results"
              : `${results.length} result${results.length !== 1 ? "s" : ""}`}
            {hasFilters && " (filtered)"}
          </div>
        )}

        {/* Results */}
        {ftsQuery ? (
          loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 72,
                    borderRadius: 8,
                    background: "var(--bg-overlay)",
                    opacity: 0.6,
                  }}
                />
              ))}
            </div>
          ) : results.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "48px 0",
                color: "var(--text-low)",
              }}
            >
              <Search size={28} style={{ opacity: 0.4 }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-mid)" }}>
                  No results for "{ftsQuery}"
                </div>
                <div style={{ fontSize: 12, color: "var(--text-low)", marginTop: 4 }}>
                  Try different keywords or clear some filters.
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {results.map((r) => (
                <ResultCard key={r.id} result={r} />
              ))}
            </div>
          )
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "64px 0",
              color: "var(--text-low)",
            }}
          >
            <Search size={32} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: 14, color: "var(--text-mid)" }}>
              Start typing to search your snapshots
            </div>
            <div style={{ fontSize: 12, color: "var(--text-low)" }}>
              Press{" "}
              <kbd
                style={{
                  padding: "1px 5px",
                  borderRadius: 4,
                  background: "var(--bg-overlay)",
                  border: "1px solid var(--border-strong)",
                  fontFamily: "monospace",
                  fontSize: 11,
                }}
              >
                ⌘K
              </kbd>{" "}
              for quick search from anywhere
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
