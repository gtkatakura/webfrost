import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeviceRequest } from "@webfrost/sdk";
import { Check, ShieldAlert, Terminal, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { ErrorState, PageHeader, Skeleton } from "../components/ui/StateViews";
import { useClient } from "../context";
import { LoginCommand } from "../features/failures/shared";
import { errorMessage } from "../lib/errors";

const requestKey = (code: string) => ["device-request", code] as const;

/** The code as the terminal shows it: letters only, upper case, a dash in the middle. */
function tidyCode(raw: string): string {
  const letters = raw
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

/** Asks for the code when the address carries none (the person opened the page by hand). */
function CodeForm({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [draft, setDraft] = useState("");
  const complete = draft.replace("-", "").length === 8;
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="m-0 text-ui-lg font-semibold text-high">Enter the code</h2>
      <p className="mb-0 mt-1 text-ui-sm text-mid">
        Run this on the computer you want to connect. It prints a code and opens this page:
      </p>
      <LoginCommand />
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete) onSubmit(draft);
        }}
      >
        <input
          type="text"
          aria-label="Code from the terminal"
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(tidyCode(e.target.value))}
          className="field !w-40 font-mono tracking-widest"
        />
        <Button type="submit" disabled={!complete}>
          Continue
        </Button>
      </form>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 py-1.5">
      <dt className="w-32 shrink-0 text-ui-sm text-mid">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 break-words text-ui-sm text-high">{children}</dd>
    </div>
  );
}

/** The request behind a code: what is asking, and the two answers. */
function RequestCard({ code, onAnother }: { code: string; onAnother: () => void }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [answered, setAnswered] = useState<"approved" | "denied" | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery<DeviceRequest | null>({
    queryKey: requestKey(code),
    queryFn: () => client.getDeviceRequest(code),
    // Asked once: the answer below is what changes it, and a request that is gone stays gone.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const answer = useMutation({
    mutationFn: async (decision: "approve" | "deny") => {
      const ok =
        decision === "approve"
          ? await client.approveDeviceRequest(code)
          : await client.denyDeviceRequest(code);
      if (!ok) throw new Error("This request has expired or was answered already.");
      return decision;
    },
    onSuccess: (decision) => {
      setAnswered(decision === "approve" ? "approved" : "denied");
      // The new key is listed in Settings from now on.
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  if (isPending) {
    return (
      <section className="rounded-lg border border-border bg-surface p-5" aria-busy="true">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-2/3" />
      </section>
    );
  }
  if (isError) {
    return (
      <ErrorState title="Could not load the request" error={error} onRetry={() => refetch()} />
    );
  }

  if (answered === "approved") {
    return (
      <section className="rounded-lg border border-success/40 bg-success/10 p-5" role="status">
        <h2 className="m-0 flex items-center gap-2 text-ui-lg font-semibold text-success">
          <Check size={18} aria-hidden="true" /> Connected
        </h2>
        <p className="mb-0 mt-2 text-ui-sm text-high">
          The command line finishes by itself in a moment; you can close this page. Its API key is
          listed as <strong>{data?.name}</strong> under{" "}
          <Link to="/settings/api-keys">Settings, API keys</Link>, where you can revoke it.
        </p>
      </section>
    );
  }
  if (answered === "denied") {
    return (
      <section className="rounded-lg border border-border bg-surface p-5" role="status">
        <h2 className="m-0 text-ui-lg font-semibold text-high">Request denied</h2>
        <p className="mb-0 mt-2 text-ui-sm text-mid">
          Nothing was connected and no API key was created.
        </p>
      </section>
    );
  }

  if (!data || data.status !== "pending") {
    return (
      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="m-0 text-ui-lg font-semibold text-high">
          {data ? "This request was answered already" : "No request with this code"}
        </h2>
        <p className="mb-0 mt-2 text-ui-sm text-mid">
          {data
            ? "A request is answered once. Run webfrost login again for a new one."
            : "The code is wrong, or the request expired (it waits 10 minutes). Check the code in your terminal, or run webfrost login again."}
        </p>
        <div className="mt-4">
          <Button variant="secondary" onClick={onAnother}>
            Enter another code
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="m-0 flex items-center gap-2 text-ui-lg font-semibold text-high">
        <Terminal size={18} aria-hidden="true" /> A command line asks to connect
      </h2>
      <p className="mb-0 mt-3 text-ui-sm text-mid">Code shown in the terminal</p>
      <p
        className="m-0 font-mono text-[1.75rem] font-semibold tracking-[0.2em] text-high"
        data-testid="device-code"
      >
        {data.userCode}
      </p>
      <dl className="mb-0 mt-4 border-t border-border pt-3">
        <Detail label="Name">{data.name}</Detail>
        <Detail label="Requested from">
          <span className="font-mono">{data.requesterIp}</span>
        </Detail>
        <Detail label="Requested at">{new Date(data.requestedAt).toLocaleString()}</Detail>
      </dl>
      <p className="mb-0 mt-4 flex gap-2 rounded-md bg-overlay px-3 py-2.5 text-ui-sm text-high">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-mid" aria-hidden="true" />
        <span>
          Approve only if you just ran <code>webfrost login</code> yourself and your terminal shows
          this same code. Approving creates an API key with full access to this archive and hands it
          to that command line. If someone sent you this link, deny it.
        </span>
      </p>
      {answer.isError && (
        <p role="alert" className="mb-0 mt-3 text-ui-sm text-danger">
          {errorMessage(answer.error)}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => answer.mutate("approve")} disabled={answer.isPending}>
          <Check size={15} aria-hidden="true" /> Approve
        </Button>
        <Button
          variant="secondary"
          onClick={() => answer.mutate("deny")}
          disabled={answer.isPending}
        >
          <X size={15} aria-hidden="true" /> Deny
        </Button>
      </div>
    </section>
  );
}

/**
 * Where `webfrost login` sends the person: it shows the request behind the code in the address
 * and takes the answer. Reached only signed in, since approving creates an API key.
 */
export function ConnectPage() {
  const [params, setParams] = useSearchParams();
  const code = tidyCode(params.get("code") ?? "");
  const complete = code.replace("-", "").length === 8;

  function setCode(next: string | null) {
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        if (next) updated.set("code", next);
        else updated.delete("code");
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Connect a command line"
        description="Give the webfrost CLI on a computer access to this archive, without copying an API key."
      />
      {complete ? (
        <RequestCard key={code} code={code} onAnother={() => setCode(null)} />
      ) : (
        <CodeForm onSubmit={setCode} />
      )}
    </main>
  );
}
