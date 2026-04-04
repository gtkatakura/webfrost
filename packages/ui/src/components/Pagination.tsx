import { ChevronLeft, ChevronRight } from "lucide-react";

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
  onPage?: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  function getPageNumbers(): (number | "...")[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | "...")[] = [1];
    if (page > 3) pages.push("...");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
    return pages;
  }

  function goTo(target: number) {
    if (target === page) return;
    if (onPage) {
      onPage(target);
    } else if (target < page) {
      for (let i = 0; i < page - target; i++) onPrev();
    } else {
      for (let i = 0; i < target - page; i++) onNext();
    }
  }

  const pageNumbers = getPageNumbers();
  const btnBase =
    "rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors";

  return (
    <div className="flex justify-center items-center gap-1 mt-6">
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 1}
        aria-label="Previous page"
        className={`p-1.5 ${btnBase} ${
          page === 1
            ? "cursor-not-allowed opacity-40"
            : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
        }`}
      >
        <ChevronLeft size={16} />
      </button>

      {pageNumbers.map((p, i) =>
        p === "..." ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: ellipsis separators have no identity
          <span key={`ellipsis-${i}`} className="px-1.5 text-sm text-gray-400">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => goTo(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? "page" : undefined}
            className={`min-w-[2rem] h-8 px-2 text-sm ${btnBase} ${
              p === page
                ? "bg-primary text-white border-primary font-semibold cursor-default"
                : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
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
        className={`p-1.5 ${btnBase} ${
          page === totalPages
            ? "cursor-not-allowed opacity-40"
            : "cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
        }`}
      >
        <ChevronRight size={16} />
      </button>

      <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
        {page} / {totalPages}
      </span>
    </div>
  );
}
