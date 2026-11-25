import { useMutation } from "@tanstack/react-query";
import type { FailureGroupId, FailureSelection } from "@webfrost/sdk";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useClient } from "../../context";
import { errorMessage } from "../../lib/errors";
import { deletedMessage, plural, useRefreshAll } from "./shared";

/** Retry, trash and delete on a failure group, with the toasts that report each result. */
export function useFailureActions(group: FailureGroupId, onDone?: () => void) {
  const client = useClient();
  const navigate = useNavigate();
  const refresh = useRefreshAll();

  const done = () => {
    refresh();
    onDone?.();
  };

  const retry = useMutation({
    mutationFn: (selection: FailureSelection) => client.retryFailures(group, selection),
    onSuccess: ({ queued, stillGone }) => {
      done();
      if (group === "domain-gone") {
        const back = queued > 0 ? `${plural(queued, "snapshot")} queued` : "nothing queued";
        const gone = stillGone.length ? `; ${stillGone.length} still gone` : "";
        if (queued === 0 && stillGone.length > 0) {
          toast.info(`Still gone: ${plural(stillGone.length, "domain")} did not resolve`);
        } else {
          toast.success(`Domains back: ${back}${gone}`);
        }
      } else {
        toast.success(`${plural(queued, "snapshot")} queued again`);
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const trash = useMutation({
    mutationFn: (selection: FailureSelection) => client.trashFailures(group, selection),
    onSuccess: ({ trashed }, selection) => {
      done();
      const message = `Moved ${plural(trashed, "snapshot")} to the trash`;
      const ids = selection.ids;
      if (ids && ids.length > 0 && !selection.hosts?.length) {
        toast.success(message, {
          action: {
            label: "Undo",
            onClick: () => {
              client
                .restoreFromTrash(ids)
                .then(({ restored }) => {
                  refresh();
                  toast.success(`Restored ${plural(restored, "snapshot")}`);
                })
                .catch((e) => toast.error(errorMessage(e)));
            },
          },
        });
      } else {
        toast.success(`${message}. Restore them from the Trash`, {
          action: { label: "Open Trash", onClick: () => navigate("/trash") },
        });
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (selection: FailureSelection) => client.deleteFailures(group, selection),
    onSuccess: ({ deleted, busy }) => {
      done();
      toast.success(deletedMessage(deleted, busy));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return { retry, trash, remove, busy: retry.isPending || trash.isPending || remove.isPending };
}
