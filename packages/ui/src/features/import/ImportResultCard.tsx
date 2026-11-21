import type { ImportResult } from "@webfrost/sdk";
import { CheckCircle, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { FORMAT_LABELS } from "./ImportForm";

export function ImportResultCard({
  result,
  onReset,
}: { result: ImportResult; onReset: () => void }) {
  const stats = [
    { label: "Total found", value: result.total, tone: "text-high" },
    { label: "Queued", value: result.queued, tone: "text-success" },
    { label: "Skipped", value: result.skipped, tone: "text-mid" },
  ];
  return (
    <div
      role="status"
      className="flex flex-col gap-4 rounded-xl border border-success/30 bg-success/5 p-5"
    >
      <div className="flex items-center gap-2.5">
        <CheckCircle size={18} className="shrink-0 text-success" aria-hidden="true" />
        <div>
          <div className="text-ui-base font-semibold text-high">Import complete</div>
          <div className="mt-0.5 text-ui-sm text-mid">
            Format detected: {FORMAT_LABELS[result.format] ?? result.format}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map(({ label, value, tone }) => (
          <div key={label} className="rounded-lg bg-overlay px-3 py-2.5 text-center">
            <div className={`text-[22px] font-bold leading-none ${tone}`}>{value}</div>
            <div className="mt-1 text-ui-xs text-mid">{label}</div>
          </div>
        ))}
      </div>

      {result.queued > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-ui-sm text-mid">
          <Clock size={12} aria-hidden="true" />
          {result.queued} URL{result.queued !== 1 ? "s" : ""} queued for archiving.{" "}
          <Link to="/snapshots" className="font-medium">
            View snapshots →
          </Link>
        </div>
      )}

      <div>
        <Button variant="secondary" size="sm" onClick={onReset}>
          Import more
        </Button>
      </div>
    </div>
  );
}
