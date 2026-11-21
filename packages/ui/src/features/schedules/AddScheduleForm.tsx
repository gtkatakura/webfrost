import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/Button";
import { UrlField } from "../../components/ui/UrlField";
import { useClient } from "../../context";
import { errorMessage } from "../../lib/errors";
import { normalizeUrl } from "../../lib/url";
import { PRESETS, SCHEDULE_KEYS } from "./cron";

export function AddScheduleForm() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [cron, setCron] = useState("");

  const create = useMutation({
    mutationFn: ({ url, cron }: { url: string; cron: string }) => client.createSchedule(url, cron),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCHEDULE_KEYS.all });
      setUrl("");
      setCron("");
      toast.success("Schedule created");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const result = normalizeUrl(url);
    if (!result.ok) {
      setUrlError(result.error);
      return;
    }
    if (!cron.trim()) return;
    create.mutate({ url: result.url, cron: cron.trim() });
  }

  return (
    <section
      aria-labelledby="new-schedule"
      className="mb-6 rounded-xl border border-border bg-surface px-5 py-4"
    >
      <h2
        id="new-schedule"
        className="mb-3 mt-0 text-ui-sm font-semibold tracking-wider text-mid uppercase"
      >
        New schedule
      </h2>
      <form onSubmit={handleCreate} noValidate className="flex flex-wrap items-start gap-3">
        <UrlField
          label="URL"
          value={url}
          onChange={(v) => {
            setUrl(v);
            setUrlError(null);
          }}
          error={urlError}
          className="min-w-52 flex-1"
        />
        <label className="flex flex-col gap-1 text-ui-sm font-medium text-mid">
          Preset
          <select
            className="field !w-auto"
            value={PRESETS.find((p) => p.value === cron)?.value ?? ""}
            onChange={(e) => {
              if (e.target.value) setCron(e.target.value);
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-ui-sm font-medium text-mid">
          Cron expression
          <input
            type="text"
            placeholder="0 * * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            required
            className="field w-40 font-mono"
          />
        </label>
        <Button type="submit" size="lg" disabled={create.isPending} className="self-end">
          <Plus size={14} aria-hidden="true" />
          {create.isPending ? "Creating…" : "Add schedule"}
        </Button>
      </form>
    </section>
  );
}
