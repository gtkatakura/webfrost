import type { ReactNode } from "react";
import { Logo, Mascot } from "./Logo";

/** Centered card on the app background: the frame for login, setup and "server unreachable". */
export function AuthShell({
  subtitle,
  children,
  mascot = true,
}: {
  subtitle: string;
  children: ReactNode;
  mascot?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          {mascot && <Mascot width={220} className="mb-4" />}
          <Logo size={30} className="text-2xl" />
          <p className="mt-1.5 mb-0 text-ui-base text-mid">{subtitle}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export const cardCls =
  "flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-sm";
