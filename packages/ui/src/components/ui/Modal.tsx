import { type ReactNode, useEffect, useId, useRef } from "react";
import { Toaster } from "sonner";

type Variant = "center" | "top" | "side" | "full";

const variantCls: Record<Variant, string> = {
  center:
    "m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-border bg-surface shadow-2xl animate-pop-in",
  top: "mx-auto mt-[12dvh] mb-auto w-[calc(100%-2rem)] max-w-xl rounded-xl border border-border-strong bg-surface shadow-2xl animate-pop-in",
  side: "ml-auto mr-0 my-0 h-dvh max-h-dvh w-full sm:w-[56rem] sm:max-w-[92vw] border-l border-border bg-surface shadow-2xl animate-slide-in-right",
  full: "m-0 h-dvh max-h-dvh w-screen max-w-none bg-surface",
};

interface ModalProps {
  onClose: () => void;
  /** Accessible name. Provide either this or labelledBy. */
  label?: string;
  /** Id of an element inside the modal that names it. */
  labelledBy?: string;
  variant?: Variant;
  children: ReactNode;
}

/**
 * The one dialog primitive. Built on the native <dialog> opened with showModal(), so the
 * browser supplies the focus trap, the inert page behind it and the top layer; this adds
 * Escape handling through React state, click on the backdrop to close, and focus restore.
 */
export function Modal({ onClose, label, labelledBy, variant = "center", children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    // The dialog focuses its first focusable child; fall back to the dialog itself.
    if (!dialog.contains(document.activeElement)) dialog.focus();
    return () => {
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={`fixed inset-0 p-0 overflow-hidden text-high ${variantCls[variant]}`}
      onCancel={(e) => {
        // Escape: let React state decide, so the dialog never closes behind its owner's back.
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // With no padding on the dialog, a click that lands on the dialog itself is the backdrop.
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
      onKeyDown={(e) => {
        // happy-dom and old browsers do not fire cancel for Escape.
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current();
        }
      }}
    >
      {children}
      {/* A modal dialog sits in the top layer, above the app-level toaster: a second one lives
          inside it so errors raised from the dialog are not hidden behind it. */}
      <Toaster richColors position="bottom-right" />
    </dialog>
  );
}

/** Stable id helper so callers can wire aria-labelledby without inventing ids. */
export function useModalTitleId(): string {
  return `modal-title-${useId().replace(/:/g, "")}`;
}
