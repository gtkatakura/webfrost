import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { TrashSelection } from "@webfrost/sdk";
import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { ConfirmDeleteModal } from "../components/ui/ConfirmDeleteModal";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "../components/ui/StateViews";
import { useClient } from "../context";
import {
  LoadMore,
  OpenCell,
  OriginalLink,
  PAGE_SIZE,
  SelectAllBanner,
  SelectCell,
  SelectRow,
  SelectionToolbar,
  TRASH_KEYS,
  deletedMessage,
  flatten,
  formatDate,
  nextPageParam,
  plural,
  useListSelection,
  useRefreshAll,
  useRowSelect,
} from "../features/failures/shared";
import { errorMessage } from "../lib/errors";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function TrashPage() {
  const client = useClient();
  const refresh = useRefreshAll();
  const [confirming, setConfirming] = useState<null | "selected" | "all">(null);

  const list = useInfiniteQuery({
    queryKey: TRASH_KEYS.list(),
    queryFn: ({ pageParam }) => client.listTrash({ page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: nextPageParam,
  });
  const items = flatten(list.data);
  const total = list.data?.pages[0]?.total ?? 0;
  const retentionDays = list.data?.pages[0]?.retentionDays;

  const done = () => {
    sel.clear();
    setConfirming(null);
    refresh();
  };

  const restore = useMutation({
    mutationFn: (sel: number[] | TrashSelection) => client.restoreFromTrash(sel),
    onSuccess: ({ restored }) => {
      done();
      toast.success(`Restored ${plural(restored, "snapshot")}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (sel: number[] | TrashSelection) => client.deleteFromTrash(sel),
    onSuccess: ({ deleted, busy }) => {
      done();
      toast.success(deletedMessage(deleted, busy));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const empty = useMutation({
    mutationFn: () => client.emptyTrash(),
    onSuccess: ({ deleted, busy }) => {
      done();
      toast.success(
        `Trash emptied: ${plural(deleted, "snapshot")} deleted${busy ? ` (${busy} kept)` : ""}`,
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sel = useListSelection<number>();
  const busy = restore.isPending || remove.isPending || empty.isPending;
  const count = sel.all ? total - sel.size : sel.size;
  const allLoadedSelected = items.length > 0 && items.every((s) => sel.isSelected(s.id));
  const selection: TrashSelection = sel.all
    ? { all: true, excludeIds: sel.keys }
    : { ids: sel.keys };
  const onlyOne = count === 1 ? items.find((s) => sel.isSelected(s.id)) : undefined;
  const deletePhrase = onlyOne ? hostOf(onlyOne.url) : `delete ${count} snapshots`;

  const select = useRowSelect(
    items.map((s) => s.id),
    sel.isSelected,
    sel.apply,
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Trash"
        description={
          retentionDays !== undefined ? (
            <>
              Snapshots here are hidden everywhere and deleted for good after {retentionDays}{" "}
              {retentionDays === 1 ? "day" : "days"} (<Link to="/settings">Settings</Link>).
            </>
          ) : (
            "Snapshots here are hidden everywhere and deleted for good after a while."
          )
        }
      >
        {total > 0 && (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirming("all")}>
            Empty trash
          </Button>
        )}
      </PageHeader>

      <SelectAllBanner
        noun="snapshots"
        loaded={items.length}
        total={total}
        selectedCount={count}
        allMode={sel.all}
        allLoadedSelected={allLoadedSelected}
        onSelectAll={sel.enterAll}
        onClear={sel.clear}
      />

      {count > 0 && (
        <SelectionToolbar summary={`${plural(count, "snapshot")} selected`}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => restore.mutate(selection)}
          >
            <RotateCcw size={13} aria-hidden /> Restore
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming("selected")}
          >
            Delete permanently
          </Button>
        </SelectionToolbar>
      )}

      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.isError ? (
        <ErrorState
          title="Could not load the trash"
          error={list.error}
          onRetry={() => list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 size={24} />} title="The trash is empty">
          Snapshots you move to the trash show up here until they are deleted for good.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-overlay">
                  <th className="w-12 py-2 pl-4 text-left">
                    <input
                      type="checkbox"
                      aria-label="Select all loaded"
                      checked={allLoadedSelected}
                      onChange={() =>
                        allLoadedSelected && sel.all
                          ? sel.clear()
                          : sel.apply(
                              items.map((s) => s.id),
                              !allLoadedSelected,
                            )
                      }
                    />
                  </th>
                  <th className="label-caps whitespace-nowrap py-2 pr-3 text-left">Snapshot</th>
                  <th className="label-caps whitespace-nowrap hidden py-2 pr-4 text-left sm:table-cell">
                    Trashed
                  </th>
                  <th className="label-caps whitespace-nowrap hidden py-2 pr-4 text-left md:table-cell">
                    Deleted on
                  </th>
                  <th className="w-10" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <SelectRow
                    key={s.id}
                    selected={sel.isSelected(s.id)}
                    onSelect={(shift) => select(s.id, shift)}
                  >
                    <SelectCell selected={sel.isSelected(s.id)} label={`Select snapshot ${s.id}`} />
                    <td className="w-full max-w-0 py-2.5 pr-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-high" title={s.url}>
                          {s.url}
                        </span>
                        <OriginalLink url={s.url} />
                      </div>
                      {s.failure && <div className="text-ui-xs text-mid">{s.failure.label}</div>}
                      <div className="text-ui-xs text-low sm:hidden">
                        Trashed {formatDate(s.trashedAt)}
                      </div>
                    </td>
                    <td className="hidden py-2.5 pr-4 align-top whitespace-nowrap text-ui-sm text-mid sm:table-cell">
                      Trashed {formatDate(s.trashedAt)}
                    </td>
                    <td className="hidden py-2.5 pr-4 align-top whitespace-nowrap text-ui-sm text-mid md:table-cell">
                      {s.deleteAfter ? `Deleted on ${formatDate(s.deleteAfter)}` : "—"}
                    </td>
                    <OpenCell to={`/snapshots/${s.id}`} label="Open snapshot" />
                  </SelectRow>
                ))}
              </tbody>
            </table>
          </div>
          <LoadMore
            hasNext={!!list.hasNextPage}
            loading={list.isFetchingNextPage}
            onLoad={() => list.fetchNextPage()}
          />
        </div>
      )}

      {confirming === "selected" && (
        <ConfirmDeleteModal
          title="Delete permanently"
          phrase={deletePhrase}
          pending={remove.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => remove.mutate(selection)}
        >
          {plural(count, "snapshot")} and their files will be deleted for good.
        </ConfirmDeleteModal>
      )}
      {confirming === "all" && (
        <ConfirmDeleteModal
          title="Empty the trash"
          phrase="empty trash"
          confirmLabel="Empty trash"
          pending={empty.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => empty.mutate()}
        >
          Everything in the trash ({plural(total, "snapshot")}) and its files will be deleted for
          good.
        </ConfirmDeleteModal>
      )}
    </main>
  );
}
