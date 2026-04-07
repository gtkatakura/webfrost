import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiKey } from "@webfrost/sdk";
import { WebFrostError } from "@webfrost/sdk";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useClient } from "../context";

const inputCls =
  "py-2 px-3 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 w-full";

function formatDate(val: string | null): string {
  if (!val) return "—";
  return new Date(val).toLocaleString();
}

const API_KEY_QUERY = ["api-keys"] as const;

export function ApiKeysPage() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const rawKeyRef = useRef<HTMLInputElement>(null);

  const { data: keys = [], isPending: loading } = useQuery<ApiKey[]>({
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
    onError: (err) => toast.error(err instanceof WebFrostError ? err.message : String(err)),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => client.revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: API_KEY_QUERY });
      toast.success("API key revoked");
    },
    onError: (err) => toast.error(err instanceof WebFrostError ? err.message : String(err)),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(name.trim());
  }

  function handleRevoke(id: string, keyName: string) {
    if (!confirm(`Revoke API key "${keyName}"? This cannot be undone.`)) return;
    revokeMutation.mutate(id);
  }

  function handleCopy() {
    if (!newRawKey) return;
    navigator.clipboard
      .writeText(newRawKey)
      .then(() => toast.success("Copied to clipboard"))
      .catch(() => toast.error("Copy failed"));
  }

  const creating = createMutation.isPending;

  return (
    <main className="max-w-[760px] mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">API Keys</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        API keys grant programmatic access to WebFrost. Keys are shown only once at creation.
      </p>

      {/* New key banner */}
      {newRawKey && (
        <div className="mb-8 p-4 rounded border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30">
          <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
            New API key created — copy it now. It will not be shown again.
          </p>
          <div className="flex gap-2">
            <input
              ref={rawKeyRef}
              readOnly
              value={newRawKey}
              className="flex-1 py-2 px-3 border border-green-300 dark:border-green-700 rounded text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700 transition-colors border-0 cursor-pointer shrink-0"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setNewRawKey(null)}
              className="px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      <section className="mb-8">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Create new key
        </h2>
        <form onSubmit={handleCreate} className="flex gap-2 max-w-sm">
          <input
            type="text"
            placeholder="Key name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="px-4 py-2 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors border-0 cursor-pointer shrink-0"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      {/* Keys table */}
      <section>
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Active keys
        </h2>
        {loading ? (
          <div className="text-sm text-gray-400 dark:text-gray-500">Loading…</div>
        ) : keys.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500">No API keys yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">
                    Name
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">
                    Created
                  </th>
                  <th className="text-left py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">
                    Last used
                  </th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr
                    key={key.id}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <td className="py-2 pr-4 text-gray-900 dark:text-gray-100 font-medium">
                      {key.name}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 dark:text-gray-400">
                      {formatDate(key.lastUsedAt)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleRevoke(key.id, key.name)}
                        className="px-3 py-1 text-xs font-medium rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                      >
                        Revoke
                      </button>
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
