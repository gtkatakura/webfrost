export function ExtractorBadge({
  extractor,
  hasContent,
}: {
  extractor: string;
  hasContent: boolean;
}) {
  return (
    <span
      title={extractor}
      className={`inline-block py-0.5 px-2 rounded text-xs font-medium ${
        hasContent
          ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300"
          : "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300"
      }`}
    >
      {extractor}
    </span>
  );
}
