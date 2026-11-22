import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schedule } from "@webfrost/sdk";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useClient } from "../context";
import { AddScheduleForm } from "../features/schedules/AddScheduleForm";
import { ScheduleRow } from "../features/schedules/ScheduleRow";
import { SCHEDULE_KEYS } from "../features/schedules/cron";
import { collect } from "../lib/collect";
import { errorMessage } from "../lib/errors";

const COLUMNS = ["URL", "Schedule", "Health", "Last run", "Next run"];

export function SchedulesPage() {
  const client = useClient();
  const queryClient = useQueryClient();

  const {
    data: schedules = [],
    isPending: loading,
    isError,
    error,
    refetch,
  } = useQuery<Schedule[]>({
    queryKey: SCHEDULE_KEYS.list(),
    queryFn: () => collect(client.iterateSchedules()),
  });

  const deleteSchedule = useMutation({
    mutationFn: (id: number) => client.deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCHEDULE_KEYS.all });
      toast.success("Schedule deleted");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const activeCount = schedules.filter((s) => s.nextRunAt !== null).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Schedules"
        badge={
          !loading &&
          schedules.length > 0 && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-ui-xs font-semibold text-accent-text">
              {activeCount} active
            </span>
          )
        }
      />

      <AddScheduleForm />

      {loading ? (
        <LoadingRows rows={3} />
      ) : isError ? (
        <ErrorState title="Could not load schedules" error={error} onRetry={() => refetch()} />
      ) : schedules.length === 0 ? (
        <EmptyState icon={<CalendarClock size={24} />} title="No schedules yet">
          Add a schedule above to automatically archive URLs on a recurring basis.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="block w-full border-collapse sm:table">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-border bg-overlay">
                  {COLUMNS.map((h, i) => (
                    <th
                      key={h}
                      className={`label-caps whitespace-nowrap py-2 pr-3 text-left ${
                        i === 0 ? "pl-4" : ""
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                  <th className="py-2 pr-4">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {schedules.map((s) => (
                  <ScheduleRow
                    key={s.id}
                    schedule={s}
                    onDelete={(id) => deleteSchedule.mutate(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
