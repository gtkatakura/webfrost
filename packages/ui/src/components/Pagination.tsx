import { ChevronLeft, ChevronRight } from "lucide-react";

function pageNumbers(page: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | "...")[] = [1];
  if (page > 3) pages.push("...");
  for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
  if (page < totalPages - 2) pages.push("...");
  pages.push(totalPages);
  return pages;
}

const btn =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-border bg-surface px-2 text-ui-base text-high transition-colors hover:bg-subtle disabled:opacity-40 disabled:hover:bg-surface";

export function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div
      role="group"
      aria-label="Pagination"
      className="mt-6 mb-4 flex flex-wrap items-center justify-center gap-1"
    >
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 1}
        aria-label="Previous page"
        className={btn}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>

      {pageNumbers(page, totalPages).map((p, i) =>
        p === "..." ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: ellipsis separators have no identity
          <span key={`ellipsis-${i}`} className="px-1.5 text-ui-base text-low" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => p !== page && onPage(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={`${btn} ${
              p === page
                ? "!border-accent !bg-accent font-semibold !text-accent-fg hover:!bg-accent"
                : ""
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={page === totalPages}
        aria-label="Next page"
        className={btn}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      <span className="ml-2 text-ui-base text-mid">
        {page} / {totalPages}
      </span>
    </div>
  );
}
