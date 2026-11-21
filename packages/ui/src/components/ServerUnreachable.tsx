import { ServerCrash } from "lucide-react";
import { errorMessage } from "../lib/errors";
import { AuthShell, cardCls } from "./AuthShell";
import { Button } from "./ui/Button";

/** Shown instead of the login form when the very first request fails (server down or erroring). */
export function ServerUnreachable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <AuthShell subtitle="Can't reach the WebFrost server" mascot={false}>
      <div role="alert" className={cardCls}>
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
          <ServerCrash size={22} aria-hidden="true" />
        </span>
        <p className="m-0 text-center text-ui-base text-mid">
          The server did not answer, so there is nothing to sign in to yet. Check that it is running
          and that your network is up, then try again.
        </p>
        <p className="m-0 break-words text-center font-mono text-ui-sm text-low">
          {errorMessage(error)}
        </p>
        <Button size="lg" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </AuthShell>
  );
}
