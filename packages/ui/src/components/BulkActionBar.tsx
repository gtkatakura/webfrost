import type { Tag } from "@webfrost/sdk";

export function BulkActionBar({
  count,
  status,
  allTags,
  onDelete,
  onTag,
}: {
  count: number;
  status: string | null;
  allTags: Tag[];
  onDelete: () => void;
  onTag: (tagId: number) => void;
}) {
  const busy = status !== null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-xl shadow-xl flex items-center gap-3 py-2.5 px-4 text-sm z-50">
      <span className="font-medium">{status ?? `${count} selected`}</span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className="bg-red-500 hover:bg-red-600 disabled:opacity-50 border-0 text-white rounded-lg py-1 px-3 cursor-pointer text-sm font-medium"
      >
        Delete
      </button>
      {allTags.length > 0 && (
        <select
          disabled={busy}
          className="bg-gray-700 text-white border-0 rounded-lg py-1 px-2 text-sm cursor-pointer disabled:opacity-50"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onTag(id);
          }}
        >
          <option value="">Tag…</option>
          {allTags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
