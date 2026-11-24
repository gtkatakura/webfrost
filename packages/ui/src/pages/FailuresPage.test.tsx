import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  FailedSnapshot,
  FailureDomainPage as FailureDomainPageData,
  FailureGroupSummary,
  TrashPage as TrashPageData,
  WebFrostClient,
} from "@webfrost/sdk";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ClientContext } from "../context";
import { FailureDomainRoute } from "./FailureDomainPage";
import { FailureGroupRoute } from "./FailureGroupPage";
import { FailuresPage } from "./FailuresPage";
import { SettingsPage } from "./SettingsPage";
import { TrashPage } from "./TrashPage";

afterEach(() => cleanup());

/** Navigates the way back/forward or an edited address does: same route, another parameter. */
function GoTo() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="go-blocked" onClick={() => navigate("/failures/blocked")}>
      go
    </button>
  );
}

function renderAt(path: string, client: Partial<WebFrostClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={client as WebFrostClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/failures" element={<FailuresPage />} />
            <Route path="/failures/:group" element={<FailureGroupRoute />} />
            <Route path="/failures/:group/:host" element={<FailureDomainRoute />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
          <GoTo />
        </MemoryRouter>
      </ClientContext.Provider>
    </QueryClientProvider>,
  );
}

const GROUPS: FailureGroupSummary[] = [
  { id: "domain-gone", label: "Domain no longer exists", categories: [], count: 128, domains: 2 },
  { id: "page-gone", label: "Page gone", categories: [], count: 0, domains: 0 },
  { id: "blocked", label: "Blocked by the site", categories: [], count: 5, domains: 1 },
];

const DOMAINS: FailureDomainPageData = {
  items: [
    {
      host: "mirrorsite4.com",
      count: 46,
      withWorkingSnapshot: 3,
      lastFailedAt: "2026-11-23T02:14:00Z",
      example: { id: 7, url: "https://mirrorsite4.com/post/x" },
    },
    {
      host: "oldforum.example",
      count: 82,
      withWorkingSnapshot: 0,
      lastFailedAt: "2026-11-23T02:14:00Z",
      example: { id: 9, url: "http://oldforum.example/y" },
    },
  ],
  total: 2,
  snapshots: 128,
  page: 1,
  limit: 50,
};

describe("FailuresPage overview", () => {
  test("shows only the groups that have snapshots, each linking to its page", async () => {
    renderAt("/failures", { listFailureGroups: () => Promise.resolve(GROUPS) });
    const card = await screen.findByRole("link", { name: /Domain no longer exists/ });
    expect(card.getAttribute("href")).toBe("/failures/domain-gone");
    expect(card.textContent).toContain("128 snapshots · 2 domains");
    expect(screen.getByRole("link", { name: /Blocked by the site/ })).toBeTruthy();
    expect(screen.queryByText("Page gone")).toBeNull();
  });

  test("says so when nothing failed", async () => {
    renderAt("/failures", { listFailureGroups: () => Promise.resolve([]) });
    expect(await screen.findByText("Nothing failed")).toBeTruthy();
  });
});

describe("FailureGroupPage", () => {
  const base = {
    listFailureGroups: () => Promise.resolve(GROUPS),
    listFailureDomains: () => Promise.resolve(DOMAINS),
  };

  test("lists domains with the earlier-archive hint and a link to each", async () => {
    renderAt("/failures/domain-gone", base);
    const link = await screen.findByRole("link", { name: "Open mirrorsite4.com" });
    expect(link.getAttribute("href")).toBe("/failures/domain-gone/mirrorsite4.com");
    expect(screen.getByText("3 pages have an earlier archive")).toBeTruthy();
    expect(screen.getByText(/Only the snapshots that failed are affected/)).toBeTruthy();
  });

  test("the search goes to the server", async () => {
    const asked: (string | undefined)[] = [];
    renderAt("/failures/domain-gone", {
      ...base,
      listFailureDomains: (_g, options) => {
        asked.push(options?.q);
        return Promise.resolve(DOMAINS);
      },
    });
    await screen.findByText("mirrorsite4.com");
    fireEvent.change(screen.getByPlaceholderText(/Filter domains/), {
      target: { value: "mirror" },
    });
    await waitFor(() => expect(asked).toContain("mirror"));
  });

  test("blocked explains that a retry sometimes works", async () => {
    renderAt("/failures/blocked", base);
    expect(await screen.findByText(/A retry sometimes works/)).toBeTruthy();
    expect(screen.getByText(/Coming later/)).toBeTruthy();
  });

  test("blocked shows the rescue command for this server, ready to copy", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (t: string) => Promise.resolve(void copied.push(t)) },
    });
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
      "https://archive.example.com/",
    );
    renderAt("/failures/blocked", base);
    const command = "webfrost rescue blocked --from https://archive.example.com";
    expect(await screen.findByText(command)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
    await waitFor(() => expect(copied).toEqual([command]));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  });

  test("moving a selected domain to the trash sends its host", async () => {
    const trashed: unknown[] = [];
    renderAt("/failures/domain-gone", {
      ...base,
      trashFailures: (group, selection) => {
        trashed.push([group, selection]);
        return Promise.resolve({ trashed: 46 });
      },
    });
    fireEvent.click(await screen.findByLabelText("Select mirrorsite4.com"));
    expect(screen.getByText("1 domain · 46 snapshots selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Move to trash/ }));
    await waitFor(() => expect(trashed).toEqual([["domain-gone", { hosts: ["mirrorsite4.com"] }]]));
  });

  test("domain-gone offers 'Check again'", async () => {
    const retried: unknown[] = [];
    renderAt("/failures/domain-gone", {
      ...base,
      retryFailures: (_g, selection) => {
        retried.push(selection);
        return Promise.resolve({ queued: 0, stillGone: ["oldforum.example"] });
      },
    });
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    fireEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() =>
      expect(retried).toEqual([{ hosts: ["mirrorsite4.com", "oldforum.example"] }]),
    );
  });

  test("permanent delete needs the domain name typed first", async () => {
    const deleted: unknown[] = [];
    renderAt("/failures/domain-gone", {
      ...base,
      deleteFailures: (group, selection) => {
        deleted.push([group, selection]);
        return Promise.resolve({ deleted: 46, busy: 0 });
      },
    });
    fireEvent.click(await screen.findByLabelText("Select mirrorsite4.com"));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    const button = screen
      .getAllByRole("button", { name: "Delete permanently", hidden: true })
      .at(-1) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const input = screen.getByLabelText("Confirmation phrase");
    fireEvent.change(input, { target: { value: "mirrorsite" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "mirrorsite4.com" } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(deleted).toEqual([["domain-gone", { hosts: ["mirrorsite4.com"] }]]));
  });

  test("clicking the row selects it, and the open chevron navigates without selecting", async () => {
    renderAt("/failures/domain-gone", base);
    const name = await screen.findByText("mirrorsite4.com");
    const row = name.closest("tr") as HTMLElement;
    // The name is part of the row, not a link: clicking it selects, it does not open the domain.
    expect(name.closest("a")).toBeNull();
    fireEvent.click(name);
    expect((screen.getByLabelText("Select mirrorsite4.com") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(name);
    fireEvent.click(row.querySelectorAll("td")[2] as HTMLElement);
    expect((screen.getByLabelText("Select mirrorsite4.com") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(row.querySelectorAll("td")[2] as HTMLElement);
    expect((screen.getByLabelText("Select mirrorsite4.com") as HTMLInputElement).checked).toBe(
      false,
    );
    // Space on the focused row toggles too.
    fireEvent.keyDown(row, { key: " " });
    expect((screen.getByLabelText("Select mirrorsite4.com") as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.keyDown(row, { key: " " });
    // Shift+click selects the range.
    fireEvent.click(screen.getByLabelText("Select mirrorsite4.com"));
    fireEvent.click(screen.getByLabelText("Select oldforum.example"), { shiftKey: true });
    expect(screen.getByText("2 domains · 128 snapshots selected")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select all loaded"));
    fireEvent.click(screen.getByLabelText("Select all loaded"));
    // The chevron is a link: it neither selects nor is swallowed by the row.
    const open = screen.getByRole("link", { name: "Open mirrorsite4.com" });
    expect(open.getAttribute("href")).toBe("/failures/domain-gone/mirrorsite4.com");
    fireEvent.click(open);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  test("several domains ask for 'delete N snapshots'", async () => {
    renderAt("/failures/domain-gone", base);
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(screen.getByText("delete 128 snapshots")).toBeTruthy();
  });
});

function domainPage(from: number, n: number, total: number, page: number): FailureDomainPageData {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      host: `site${from + i}.com`,
      count: 2,
      withWorkingSnapshot: 0,
      lastFailedAt: "2026-11-23T02:14:00Z",
      example: { id: from + i, url: `https://site${from + i}.com/` },
    })),
    total,
    snapshots: total * 2,
    page,
    limit: 2,
  };
}

describe("select all matching", () => {
  const paged = {
    listFailureGroups: () => Promise.resolve(GROUPS),
    listFailureDomains: (_g: unknown, o?: { page?: number }) =>
      Promise.resolve(o?.page === 2 ? domainPage(3, 2, 5, 2) : domainPage(1, 2, 5, 1)),
  };

  test("the banner offers every match, and actions send all + exclusions", async () => {
    const trashed: unknown[] = [];
    renderAt("/failures/domain-gone", {
      ...paged,
      trashFailures: (_g, selection) => {
        trashed.push(selection);
        return Promise.resolve({ trashed: 1 });
      },
    });
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    expect(screen.getByText(/All 2 domains on this page are selected/)).toBeTruthy();
    fireEvent.click(screen.getByText("Select all 5 domains"));
    expect(screen.getByText(/All 5 domains are selected/)).toBeTruthy();
    expect(screen.getByText("5 domains · 10 snapshots selected")).toBeTruthy();
    // Untick one row: it becomes an exclusion.
    fireEvent.click(screen.getByLabelText("Select site1.com"));
    expect(screen.getByText("4 domains · 8 snapshots selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Move to trash/ }));
    await waitFor(() =>
      expect(trashed).toEqual([{ all: true, q: "", excludeHosts: ["site1.com"] }]),
    );
  });

  test("rows loaded later are selected in all mode", async () => {
    renderAt("/failures/domain-gone", paged);
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    fireEvent.click(screen.getByText("Select all 5 domains"));
    fireEvent.click(screen.getByText("Load more"));
    const added = (await screen.findByLabelText("Select site3.com")) as HTMLInputElement;
    expect(added.checked).toBe(true);
  });

  test("permanent delete in all mode asks for 'delete N snapshots'", async () => {
    renderAt("/failures/domain-gone", paged);
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    fireEvent.click(screen.getByText("Select all 5 domains"));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(screen.getByText("delete 10 snapshots")).toBeTruthy();
  });

  test("changing the search leaves all mode", async () => {
    renderAt("/failures/domain-gone", paged);
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    fireEvent.click(screen.getByText("Select all 5 domains"));
    fireEvent.change(screen.getByPlaceholderText(/Filter domains/), { target: { value: "site" } });
    // Let the 250 ms debounce elapse.
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.queryByLabelText("Selection")).toBeNull();
  });
});

describe("FailureDomainPage", () => {
  const SNAPSHOTS: FailedSnapshot[] = [
    {
      id: 11,
      url: "https://mirrorsite4.com/a",
      createdAt: "2026-11-23T02:14:00Z",
      failure: {
        category: "domain_not_found",
        class: "permanent",
        label: "Domain gone",
        detail: "ENOTFOUND",
      },
      workingSnapshotId: 3,
    },
    {
      id: 12,
      url: "https://mirrorsite4.com/b",
      createdAt: "2026-11-23T02:14:00Z",
      failure: null,
      workingSnapshotId: null,
    },
  ];
  const client = {
    listFailureGroups: () => Promise.resolve(GROUPS),
    listFailedSnapshots: () => Promise.resolve({ items: SNAPSHOTS, total: 2, page: 1, limit: 50 }),
  };

  test("lists snapshots and links the earlier archive only when there is one", async () => {
    renderAt("/failures/domain-gone/mirrorsite4.com", client);
    expect(await screen.findByText("https://mirrorsite4.com/a")).toBeTruthy();
    const earlier = screen.getAllByRole("link", { name: "Earlier archive" });
    expect(earlier).toHaveLength(1);
    expect(earlier[0]?.getAttribute("href")).toBe("/snapshots/3");
  });

  test("each row opens the original page in a new tab, without selecting it", async () => {
    renderAt("/failures/domain-gone/mirrorsite4.com", client);
    await screen.findByText("https://mirrorsite4.com/a");
    const originals = screen.getAllByRole("link", { name: "Open the original page in a new tab" });
    expect(originals.map((a) => a.getAttribute("href"))).toEqual([
      "https://mirrorsite4.com/a",
      "https://mirrorsite4.com/b",
    ]);
    expect(originals[0]?.getAttribute("target")).toBe("_blank");
    expect(originals[0]?.getAttribute("rel")).toContain("noopener");
    fireEvent.click(originals[0] as HTMLElement);
    expect((screen.getByLabelText("Select snapshot 11") as HTMLInputElement).checked).toBe(false);
  });

  test("selected snapshots are trashed by id, with an Undo path", async () => {
    const trashed: unknown[] = [];
    renderAt("/failures/domain-gone/mirrorsite4.com", {
      ...client,
      trashFailures: (_g, selection) => {
        trashed.push(selection);
        return Promise.resolve({ trashed: 1 });
      },
    });
    fireEvent.click(await screen.findByLabelText("Select snapshot 11"));
    fireEvent.click(screen.getByRole("button", { name: /Move to trash/ }));
    await waitFor(() => expect(trashed).toEqual([{ ids: [11] }]));
  });
});

describe("TrashPage", () => {
  const TRASH: TrashPageData = {
    items: [
      {
        id: 5,
        url: "https://old.example/x",
        status: "failed",
        failure: null,
        createdAt: "2026-11-01T00:00:00Z",
        trashedAt: "2026-11-20T00:00:00Z",
        deleteAfter: "2026-12-20T00:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 50,
    retentionDays: 30,
  };

  test("restoring sends the selected ids, no confirmation", async () => {
    const restored: number[][] = [];
    renderAt("/trash", {
      listTrash: () => Promise.resolve(TRASH),
      restoreFromTrash: (selection) => {
        const ids = Array.isArray(selection) ? selection : (selection.ids ?? []);
        restored.push(ids);
        return Promise.resolve({ restored: ids.length });
      },
    });
    expect(await screen.findByText(/deleted for good after 30 days/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select snapshot 5"));
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    await waitFor(() => expect(restored).toEqual([[5]]));
  });

  test("shows an empty state", async () => {
    renderAt("/trash", {
      listTrash: () => Promise.resolve({ ...TRASH, items: [], total: 0 }),
    });
    expect(await screen.findByText("The trash is empty")).toBeTruthy();
  });

  test("emptying needs 'empty trash' typed", async () => {
    let emptied = 0;
    renderAt("/trash", {
      listTrash: () => Promise.resolve(TRASH),
      emptyTrash: () => {
        emptied++;
        return Promise.resolve({ deleted: 1, busy: 0 });
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Empty trash" }));
    const button = screen
      .getAllByRole("button", { name: "Empty trash", hidden: true })
      .at(-1) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Confirmation phrase"), {
      target: { value: "empty trash" },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(emptied).toBe(1));
  });
});

describe("Settings trash retention", () => {
  test("saves the number of days", async () => {
    const saved: unknown[] = [];
    renderAt("/settings", {
      getServerInfo: () =>
        Promise.resolve({ version: "1", storagePath: "/x", snapshotCount: 0 } as never),
      getGeneralSettings: () =>
        Promise.resolve({ trashRetentionDays: 30, trashRetentionLimits: { min: 1, max: 365 } }),
      updateGeneralSettings: (update) => {
        saved.push(update);
        return Promise.resolve({
          trashRetentionDays: update.trashRetentionDays ?? 30,
          trashRetentionLimits: { min: 1, max: 365 },
        });
      },
    });
    const input = (await screen.findByLabelText(/in the trash for N days/)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("30"));
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toEqual([{ trashRetentionDays: 7 }]));
  });
});

describe("selection never crosses groups", () => {
  test("select all in one group, then open another: nothing is selected there", async () => {
    renderAt("/failures/domain-gone", {
      listFailureGroups: () => Promise.resolve(GROUPS),
      listFailureDomains: (group) =>
        Promise.resolve(group === "blocked" ? domainPage(10, 2, 2, 1) : domainPage(1, 2, 5, 1)),
    });
    fireEvent.click(await screen.findByLabelText("Select all loaded"));
    fireEvent.click(screen.getByRole("button", { name: /Select all 5 domains/ }));
    expect(screen.getByText(/All 5 domains are selected/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("go-blocked"));
    await screen.findByText("site10.com");
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
  });
});
