import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Schedule } from "@webfrost/sdk";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useClient } from "../context";
import { AddScheduleForm } from "../features/schedules/AddScheduleForm";
import { ScheduleRow } from "../features/schedules/ScheduleRow";
import { SCHEDULE_KEYS } from "../features/schedules/cron";
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
    queryFn: () => client.listSchedules(),
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
    <main className="mx-auto max-w-[940px] px-4 py-8 sm:px-5">
      <PageHeader icon={<CalendarClock size={20} />} title="Schedules">
        {!loading && schedules.length > 0 && (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-ui-xs font-semibold text-accent">
            {activeCount} active
          </span>
        )}
      </PageHeader>

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
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-overlay">
                  {COLUMNS.map((h, i) => (
                    <th
                      key={h}
                      className={`whitespace-nowrap py-2 pr-3 text-left text-ui-xs font-semibold tracking-wider text-mid uppercase ${
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
              <tbody>
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
