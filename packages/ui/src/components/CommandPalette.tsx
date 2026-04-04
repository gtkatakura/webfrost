import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSearch } from "../hooks/useSearch";

interface CommandPaletteProps {
  onClose: () => void;
}

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { results, loading } = useSearch(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset active index when results change
  // biome-ignore lint/correctness/useExhaustiveDependencies: results triggers the reset intentionally
  useEffect(() => {
    setActiveIdx(0);
  }, [results]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length > 0 && activeIdx < results.length) {
        navigate(`/snapshots/${results[activeIdx].id}`);
        onClose();
      } else if (query.trim()) {
        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
        onClose();
      }
    }
  }

  function goToSearch() {
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`);
      onClose();
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled via onKeyDown on inner input
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] animate-fade-in"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only */}
      <div
        style={{
          width: "100%",
          maxWidth: 580,
          margin: "0 16px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "0 24px 48px rgba(0,0,0,0.3)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-default)",
            gap: 10,
          }}
        >
          <Search size={16} style={{ color: "var(--text-low)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search snapshots…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "var(--text-high)",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-low)",
                padding: 2,
                display: "flex",
              }}
            >
              <X size={14} />
            </button>
          )}
          <kbd
            style={{
              fontSize: 10,
              padding: "2px 5px",
              borderRadius: 4,
              background: "var(--bg-overlay)",
              border: "1px solid var(--border-strong)",
              color: "var(--text-low)",
              fontFamily: "ui-monospace, monospace",
              whiteSpace: "nowrap",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        {query.trim() && (
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {loading && (
              <div
                style={{
                  padding: "12px 16px",
                  fontSize: 12,
                  color: "var(--text-low)",
                  textAlign: "center",
                }}
              >
                Searching…
              </div>
            )}

            {!loading && results.length === 0 && (
              <div
                style={{
                  padding: "12px 16px",
                  fontSize: 12,
                  color: "var(--text-low)",
                  textAlign: "center",
                }}
              >
                No results. Press Enter to see full search page.
              </div>
            )}

            {!loading && results.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: "6px 0" }}>
                {results.slice(0, 8).map((r, i) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/snapshots/${r.id}`);
                        onClose();
                      }}
                      style={{
                        width: "100%",
                        padding: "8px 16px",
                        textAlign: "left",
                        background:
                          i === activeIdx
                            ? "color-mix(in srgb, var(--accent) 8%, transparent)"
                            : "none",
                        border: "none",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        borderLeft:
                          i === activeIdx ? "2px solid var(--accent)" : "2px solid transparent",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--text-high)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.url}
                      </div>
                      {r.snippet && (
                        <div
                          style={{ fontSize: 11, color: "var(--text-mid)", lineHeight: 1.5 }}
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled server snippet with <mark> tags
                          dangerouslySetInnerHTML={{ __html: r.snippet }}
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* "See all results" footer */}
            {!loading && results.length > 0 && (
              <button
                type="button"
                onClick={goToSearch}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "var(--bg-overlay)",
                  border: "none",
                  borderTop: "1px solid var(--border-default)",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text-mid)",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Search size={12} />
                See all results for "{query}"
              </button>
            )}
          </div>
        )}

        {/* Empty state hints */}
        {!query.trim() && (
          <div style={{ padding: "12px 16px 16px" }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-low)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}
            >
              Quick navigation
            </div>
            {[
              { key: "g h", label: "Home / Dashboard" },
              { key: "g s", label: "Snapshots" },
              { key: "g t", label: "Tags" },
              { key: "g i", label: "Import" },
              { key: "?", label: "Keyboard shortcuts" },
            ].map(({ key, label }) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 0",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-mid)" }}>{label}</span>
                <kbd
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "var(--bg-overlay)",
                    border: "1px solid var(--border-strong)",
                    color: "var(--text-low)",
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {key}
                </kbd>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
