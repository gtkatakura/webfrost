export function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex justify-center gap-2 mt-6 items-center">
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 1}
        className={`py-1.5 px-3 border border-gray-300 rounded bg-white ${
          page === 1 ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        }`}
      >
        ‹ Prev
      </button>
      <span className="text-sm text-gray-500">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={page === totalPages}
        className={`py-1.5 px-3 border border-gray-300 rounded bg-white ${
          page === totalPages ? "cursor-not-allowed opacity-40" : "cursor-pointer"
        }`}
      >
        Next ›
      </button>
    </div>
  );
}
