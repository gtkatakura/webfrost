import { useQuery } from "@tanstack/react-query";
import type { ImportRecord } from "@webfrost/sdk";
import { History } from "lucide-react";
import { EmptyState, ErrorState, LoadingRows } from "../../components/ui/StateViews";
import { useClient } from "../../context";
import { relativeTime } from "../../lib/format";
import { FORMAT_LABELS } from "./ImportForm";

const HEADERS = ["When", "Source", "Format", "Queued", "Skipped"];

export function ImportHistory() {
  const client = useClient();
  const {
    data: raw,
    isPending: loading,
    isError,
    error,
    refetch,
  } = useQuery<ImportRecord[]>({
    queryKey: ["imports", "list"],
    // The most recent imports; older ones are rarely useful here.
    queryFn: async () => (await client.listImports({ limit: 50 })).items,
  });

  if (loading) return <LoadingRows rows={3} rowClass="h-11" />;
  if (isError) {
    return (
      <ErrorState title="Could not load import history" error={error} onRetry={() => refetch()} />
    );
  }

  const records = raw ? raw.slice().reverse() : [];
  if (records.length === 0) {
    return (
      <EmptyState icon={<History size={20} />} title="No imports yet">
        Your past imports will appear here.
      </EmptyState>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border bg-overlay">
              {HEADERS.map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap px-3 py-2 text-left text-ui-xs font-semibold tracking-wider text-mid uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-subtle">
                <td
                  className="whitespace-nowrap px-3 py-2.5 text-ui-sm text-mid"
                  title={new Date(r.createdAt).toLocaleString()}
                >
                  {relativeTime(r.createdAt)}
                </td>
                <td className="max-w-64 px-3 py-2.5 text-ui-sm text-high">
                  {r.sourceUrl ? (
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={r.sourceUrl}
                      className="block truncate"
                    >
                      {r.sourceUrl}
                    </a>
                  ) : (
                    <span className="italic text-mid">file upload</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ui-sm text-mid">
                  {FORMAT_LABELS[r.format] ?? r.format}
                </td>
                <td
                  className={`px-3 py-2.5 text-ui-sm font-semibold ${r.queued > 0 ? "text-success" : "text-mid"}`}
                >
                  {r.queued}
                </td>
                <td className="px-3 py-2.5 text-ui-sm text-mid">{r.skipped}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
