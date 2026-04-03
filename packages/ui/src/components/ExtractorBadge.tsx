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
      className={`inline-block py-0.5 px-1.5 rounded-sm text-[0.7rem] font-semibold mr-1 ${
        hasContent ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
      }`}
    >
      {extractor}
    </span>
  );
}
