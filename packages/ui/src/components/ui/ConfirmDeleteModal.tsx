import { useState } from "react";
import { Button } from "./Button";
import { Modal, useModalTitleId } from "./Modal";

interface ConfirmDeleteModalProps {
  title: string;
  /** What will be deleted for good, in words. */
  children: React.ReactNode;
  /** The exact text the user has to type to enable the button. */
  phrase: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** A destructive action behind a typed phrase: the red button stays off until it matches. */
export function ConfirmDeleteModal({
  title,
  children,
  phrase,
  confirmLabel = "Delete permanently",
  pending = false,
  onConfirm,
  onClose,
}: ConfirmDeleteModalProps) {
  const titleId = useModalTitleId();
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === phrase;

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !pending) onConfirm();
        }}
      >
        <h2 id={titleId} className="m-0 text-ui-lg font-semibold text-high">
          {title}
        </h2>
        <div className="text-ui-sm text-mid">{children}</div>
        <p className="m-0 text-ui-sm font-medium text-danger">This cannot be undone.</p>
        <label className="flex flex-col gap-1 text-ui-sm text-high">
          <span>
            Type <strong className="select-all font-mono">{phrase}</strong> to confirm
          </span>
          <input
            className="field"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            aria-label="Confirmation phrase"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={!matches || pending}>
            {pending ? "Deleting…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
