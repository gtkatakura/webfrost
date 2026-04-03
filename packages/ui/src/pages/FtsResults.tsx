import type { SearchResult } from "@webfrost/sdk";
import { Link } from "react-router-dom";

export function FtsResults({
  query,
  results,
  loading,
}: { query: string; results: SearchResult[]; loading: boolean }) {
  if (loading) return <p className="text-gray-400 dark:text-gray-500 mb-4">Searching…</p>;
  if (results.length === 0)
    return <p className="text-gray-400 dark:text-gray-500 mb-4">No results for "{query}".</p>;
  return (
    <ul className="list-none p-0 flex flex-col gap-3 mb-4">
      {results.map((r) => (
        <li
          key={r.id}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg py-3 px-4"
        >
          <Link to={`/snapshots/${r.id}`} className="font-semibold">
            {r.url}
          </Link>
          {r.snippet && (
            <p
              className="mt-1.5 text-[0.8rem] text-gray-500 dark:text-gray-400 m-0"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled server snippet
              dangerouslySetInnerHTML={{ __html: r.snippet }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
