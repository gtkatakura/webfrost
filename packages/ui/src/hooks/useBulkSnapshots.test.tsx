import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type WebFrostClient, WebFrostError } from "@webfrost/sdk";
import type { ReactNode } from "react";
import { ClientContext } from "../context";
import { formatBulkSummary, runBulk, useBulkSnapshots } from "./useBulkSnapshots";

afterEach(cleanup);

describe("runBulk", () => {
  test("continues past failures and does not count false as success", async () => {
    const outcome = await runBulk([1, 2, 3, 4], async (id) => {
      if (id === 2) throw new WebFrostError(500, "boom");
      if (id === 3) return false;
      return true;
    });
    expect(outcome.succeeded).toEqual([1, 4]);
    expect(outcome.failed).toEqual([2]);
    expect(outcome.notFound).toEqual([3]);
    expect(outcome.firstError).toBe("boom");
    expect(formatBulkSummary("Deleted", outcome)).toBe("Deleted 2, 1 failed, 1 not found");
  });
});

describe("useBulkSnapshots.bulkDelete", () => {
  test("invalidates after a partial failure and keeps failed ids selected", async () => {
    const deleted: number[] = [];
    const client = {
      deleteSnapshot: async (id: number) => {
        if (id === 2) throw new WebFrostError(500, "boom");
        deleted.push(id);
        return true;
      },
    } as unknown as WebFrostClient;
    const queryClient = new QueryClient();
    const invalidate = spyOn(queryClient, "invalidateQueries");
    const confirm = spyOn(window, "confirm").mockReturnValue(true);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useBulkSnapshots([1, 2, 3]), { wrapper });

    act(() => result.current.toggleAll());
    expect(result.current.selectedIds.size).toBe(3);
    await act(async () => {
      await result.current.bulkDelete();
    });

    expect(deleted).toEqual([1, 3]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect([...result.current.selectedIds]).toEqual([2]);
    confirm.mockRestore();
  });
});

describe("useBulkSnapshots selection scope", () => {
  function setup(initial: number[]) {
    const deleted: number[] = [];
    const client = {
      deleteSnapshot: async (id: number) => {
        deleted.push(id);
        return true;
      },
    } as unknown as WebFrostClient;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient()}>
        <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
      </QueryClientProvider>
    );
    const hook = renderHook(({ ids }) => useBulkSnapshots(ids), {
      wrapper,
      initialProps: { ids: initial },
    });
    return { hook, deleted };
  }

  test("ids that leave the visible set are dropped and never come back", () => {
    const { hook } = setup([1, 2, 3]);
    act(() => hook.result.current.toggleAll());
    expect(hook.result.current.selectedIds.size).toBe(3);

    // Next page / narrower filter: only 4 and 2 are visible now.
    hook.rerender({ ids: [4, 2] });
    expect([...hook.result.current.selectedIds]).toEqual([2]);

    // Back to the first set: 1 and 3 must not reappear as selected.
    hook.rerender({ ids: [1, 2, 3] });
    expect([...hook.result.current.selectedIds]).toEqual([2]);
  });

  test("bulk delete only deletes visible ids and the confirmation says how many", async () => {
    const { hook, deleted } = setup([1, 2, 3]);
    act(() => hook.result.current.toggleAll());
    hook.rerender({ ids: [3] });

    const confirm = spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => {
      await hook.result.current.bulkDelete();
    });
    expect(confirm).toHaveBeenCalledWith("Delete 1 selected snapshot? This cannot be undone.");
    expect(deleted).toEqual([3]);
    confirm.mockRestore();
  });
});
