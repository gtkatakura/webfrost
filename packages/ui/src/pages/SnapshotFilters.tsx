import type { Tag } from "@webfrost/sdk";
import { TagChip } from "../components";

const KNOWN_EXTRACTORS = ["warc", "readability", "pdf"] as const;
const inputCls = "py-2 px-3 border border-gray-300 rounded text-sm";

interface SnapshotFiltersProps {
  ftsQuery: string;
  search: string;
  dateFrom: string;
  dateTo: string;
  reqExtractors: Set<string>;
  reqTags: Set<number>;
  allTags: Tag[];
  onFtsQueryChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onToggleExtractor: (ext: string) => void;
  onToggleTag: (tagId: number) => void;
}

export function SnapshotFilters({
  ftsQuery,
  search,
  dateFrom,
  dateTo,
  reqExtractors,
  reqTags,
  allTags,
  onFtsQueryChange,
  onSearchChange,
  onDateFromChange,
  onDateToChange,
  onToggleExtractor,
  onToggleTag,
}: SnapshotFiltersProps) {
  return (
    <div className="mb-4 flex flex-col gap-2">
      <input
        type="search"
        placeholder="Full-text search (title, content, tags)…"
        value={ftsQuery}
        onChange={(e) => onFtsQueryChange(e.target.value)}
        className={`w-full ${inputCls}`}
      />
      {!ftsQuery && (
        <input
          type="text"
          placeholder="Filter by URL…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={`w-full ${inputCls}`}
        />
      )}
      <div className="flex gap-2 flex-wrap items-center text-[0.8rem] text-gray-500">
        <label className="flex items-center gap-1">
          From:
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFromChange(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-1">
          To:
          <input
            type="date"
            value={dateTo}
            onChange={(e) => onDateToChange(e.target.value)}
            className={inputCls}
          />
        </label>
        <span className="ml-1">Has:</span>
        {KNOWN_EXTRACTORS.map((ext) => (
          <label key={ext} className="flex items-center gap-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={reqExtractors.has(ext)}
              onChange={() => onToggleExtractor(ext)}
            />
            {ext}
          </label>
        ))}
      </div>
      {allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap items-center text-[0.8rem] text-gray-500">
          <span>Tag:</span>
          {allTags.map((tag) => (
            <label key={tag.id} className="flex items-center gap-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={reqTags.has(tag.id)}
                onChange={() => onToggleTag(tag.id)}
              />
              <TagChip tag={tag} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
