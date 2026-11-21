import { X } from "lucide-react";
import { Modal, useModalTitleId } from "../../components/ui/Modal";
import { shortcutsFor } from "../../hooks/useKeyboardShortcuts";

export function ShortcutsModal({ onClose, canWrite }: { onClose: () => void; canWrite: boolean }) {
  const titleId = useModalTitleId();
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="m-0 text-ui-base font-semibold text-high">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border-0 bg-transparent p-1 text-mid transition-colors hover:bg-subtle hover:text-high"
            aria-label="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shortcutsFor(canWrite).map((s) => (
            <li key={s.description} className="flex items-center justify-between gap-4">
              <span className="text-ui-sm text-mid">{s.description}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
