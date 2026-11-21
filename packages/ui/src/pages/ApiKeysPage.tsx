import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiKey } from "@webfrost/sdk";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/Button";
import { ErrorState, LoadingRows } from "../components/ui/StateViews";
import { useClient } from "../context";
import { useCopy } from "../lib/clipboard";
import { errorMessage } from "../lib/errors";

const API_KEY_QUERY = ["api-keys"] as const;

function formatDate(val: string | null): string {
  return val ? new Date(val).toLocaleString() : "—";
}

export function ApiKeysPage() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const rawKeyRef = useRef<HTMLInputElement>(null);
  const { state: copyState, copy } = useCopy();

  const {
    data: keys = [],
    isPending: loading,
    isError,
    error,
    refetch,
  } = useQuery<ApiKey[]>({
    queryKey: API_KEY_QUERY,
    queryFn: () => client.listApiKeys(),
  });

  const createMutation = useMutation({
    mutationFn: (keyName: string) => client.createApiKey(keyName),
    onSuccess: (created) => {
      setNewRawKey(created.rawKey);
      setName("");
      queryClient.invalidateQueries({ queryKey: API_KEY_QUERY });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => client.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEY_QUERY });
      toast.success("API key revoked");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  function handleRevoke(id: string, keyName: string) {
    if (!window.confirm(`Revoke API key "${keyName}"? This cannot be undone.`)) return;
    revokeMutation.mutate(id);
  }

  const th = "py-2 pr-4 text-left font-medium text-mid";

  return (
    <main className="mx-auto max-w-[760px] px-4 py-8">
      <h1 className="mb-2 mt-0 text-2xl font-bold text-high">API Keys</h1>
      <p className="mb-8 mt-0 text-ui-base text-mid">
        API keys grant programmatic access to WebFrost. Keys are shown only once at creation.
      </p>

      {newRawKey && (
        <div className="mb-8 rounded-lg border border-success/40 bg-success/10 p-4">
          <p className="mb-2 mt-0 text-ui-base font-medium text-success">
            New API key created — copy it now. It will not be shown again.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={rawKeyRef}
              readOnly
              aria-label="New API key"
              value={newRawKey}
              className="field min-w-0 flex-1 font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={() => copy(newRawKey, rawKeyRef.current)}>
              {copyState === "copied" ? "Copied!" : "Copy"}
            </Button>
            <Button variant="secondary" onClick={() => setNewRawKey(null)}>
              Dismiss
            </Button>
          </div>
          <p role="status" className="mb-0 mt-2 text-ui-sm text-mid empty:hidden">
            {copyState === "copied" && "Copied to the clipboard."}
            {copyState === "failed" &&
              "Could not copy automatically. The key is selected: press Ctrl+C (or Cmd+C)."}
          </p>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 mt-0 text-base font-semibold text-high">Create new key</h2>
        <form onSubmit={handleCreate} className="flex max-w-sm gap-2">
          <input
            type="text"
            aria-label="Key name"
            placeholder="Key name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field"
          />
          <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 mt-0 text-base font-semibold text-high">Active keys</h2>
        {loading ? (
          <LoadingRows rows={2} rowClass="h-10" />
        ) : isError ? (
          <ErrorState
            title="Could not load API keys"
            error={error}
            onRetry={() => refetch()}
            compact
          />
        ) : keys.length === 0 ? (
          <p className="m-0 text-ui-base text-mid">No API keys yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-ui-base">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>Name</th>
                  <th className={th}>Created</th>
                  <th className={th}>Last used</th>
                  <th className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id} className="border-b border-border hover:bg-subtle">
                    <td className="py-2 pr-4 font-medium text-high">{key.name}</td>
                    <td className="py-2 pr-4 text-mid">{formatDate(key.createdAt)}</td>
                    <td className="py-2 pr-4 text-mid">{formatDate(key.lastUsedAt)}</td>
                    <td className="py-2 text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="!border-danger/40 !text-danger hover:!bg-danger/10"
                        onClick={() => handleRevoke(key.id, key.name)}
                        aria-label={`Revoke ${key.name}`}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
