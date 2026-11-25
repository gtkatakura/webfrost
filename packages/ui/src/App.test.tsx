import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  DashboardStats,
  ListSnapshotsOptions,
  SearchPage,
  SearchSnapshotsOptions,
  Snapshot,
  SnapshotCreated,
  SnapshotDetail,
  SnapshotPage,
  WebFrostClient,
} from "@webfrost/sdk";
import { WebFrostError } from "@webfrost/sdk";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { ClientContext } from "./context";

afterEach(() => {
  cleanup();
});

/** Status, tags and Delete live in the viewer's Details view. */
async function openDetails() {
  fireEvent.click(await screen.findByRole("tab", { name: /Details/ }));
}

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function snapshotPage(items: Snapshot[]): SnapshotPage {
  return { items, total: items.length, page: 1, limit: 20 };
}

const defaultStats: DashboardStats = {
  snapshotCount: 0,
  storageBytes: 0,
  storageByExtractor: {},
  successRate: 100,
  activeScheduleCount: 0,
  failedToday: 0,
};

function mockClient(overrides: {
  listSnapshots?: (options?: ListSnapshotsOptions) => Promise<SnapshotPage>;
  searchSnapshotsPage?: (query: string, options?: SearchSnapshotsOptions) => Promise<SearchPage>;
  createSnapshot?: (
    url: string,
    options?: { colorScheme?: "light" | "dark" },
  ) => Promise<SnapshotCreated>;
  getSnapshot?: (id: number) => Promise<SnapshotDetail | null>;
  getStats?: () => Promise<DashboardStats>;
  retrySnapshot?: (id: number) => Promise<{ id: number; status: "pending" }>;
}): WebFrostClient {
  return {
    getSetupStatus: () => Promise.resolve({ needsSetup: false }),
    getMe: () => Promise.resolve({ username: "admin" }),
    login: () => Promise.resolve({ ok: true }),
    logout: () => Promise.resolve(),
    listSnapshots: () => Promise.resolve(snapshotPage([])),
    createSnapshot: (url: string) => Promise.resolve({ id: 1, url, status: "pending" }),
    getSnapshot: () => Promise.resolve(null),
    getStats: () => Promise.resolve(defaultStats),
    iterateTags: async function* () {
      yield* [];
    },
    listSnapshotTags: () => Promise.resolve({ items: [], total: 0, page: 1, limit: 200 }),
    addTagToSnapshot: () => Promise.resolve(),
    removeTagFromSnapshot: () => Promise.resolve(),
    retrySnapshot: (id: number) => Promise.resolve({ id, status: "pending" as const }),
    ...overrides,
  } as unknown as WebFrostClient;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 1,
    url: "https://example.com",
    status: "done",
    failure: null,
    createdAt: "2024-01-15T10:00:00.000Z",
    extractors: [],
    tags: [],
    title: null,
    excerpt: null,
    screenshotUrl: null,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<SnapshotDetail> = {}): SnapshotDetail {
  return {
    id: 1,
    url: "https://example.com",
    status: "done",
    failure: null,
    createdAt: "2024-01-15T10:00:00.000Z",
    extractors: [],
    tags: [],
    archiveResults: [],
    title: null,
    excerpt: null,
    screenshotUrl: null,
    extractorMeta: {},
    ...overrides,
  };
}

function renderApp(client: WebFrostClient, initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App client={client} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// ListPage — Flow 1: Snapshot List
// ---------------------------------------------------------------------------

describe("ListPage — empty state", () => {
  test("shows empty state message when no snapshots", async () => {
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshotPage([])) });
    renderApp(client);

    const msg = await screen.findByText("No snapshots yet");
    expect(msg).toBeTruthy();
  });
});

describe("ListPage — loading", () => {
  test("shows a grid of card skeletons and a disabled Select all while loading", async () => {
    const client = mockClient({ listSnapshots: () => new Promise<SnapshotPage>(() => {}) });
    renderApp(client, "/snapshots");

    const status = await screen.findByRole("status", { name: "Loading snapshots" });
    expect(status.tagName).toBe("UL");
    expect(status.className).toContain("grid");
    expect(status.querySelectorAll("li")).toHaveLength(12);
    const selectAll = screen.getByLabelText("Select all") as HTMLInputElement;
    expect(selectAll.disabled).toBe(true);
  });
});

describe("ListPage — data renders", () => {
  test("renders a row for each snapshot", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://alpha.com" }),
      makeSnapshot({ id: 2, url: "https://beta.org", status: "pending" }),
      makeSnapshot({ id: 3, url: "https://gamma.io", extractors: ["warc"] }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshotPage(snapshots)) });
    renderApp(client);

    await screen.findByText("https://alpha.com");
    expect(screen.getByText("https://beta.org")).toBeTruthy();
    expect(screen.getByText("https://gamma.io")).toBeTruthy();
  });

  test("renders status badges for each snapshot", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://done.com", status: "done" }),
      makeSnapshot({ id: 2, url: "https://failed.com", status: "failed" }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshotPage(snapshots)) });
    renderApp(client);

    await screen.findByText("https://done.com");
    expect(screen.getAllByText("done").length).toBeGreaterThan(0);
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);
  });

  test("rows open detail on click", async () => {
    const client = mockClient({
      listSnapshots: () =>
        Promise.resolve(snapshotPage([makeSnapshot({ id: 42, url: "https://example.com" })])),
    });
    renderApp(client);

    await screen.findByText("https://example.com");
    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link.getAttribute("href")).toBe("/snapshots/42");
  });
});

// ---------------------------------------------------------------------------
// ListPage — Flow 3: the filter is answered by the server
// ---------------------------------------------------------------------------

describe("ListPage — filter", () => {
  /**
   * A server with 45 snapshots. Its first page shows beta.org; alpha.com is on a later page, so
   * only a filter the server applies can find it.
   */
  function archiveOf45(calls: Array<ListSnapshotsOptions | undefined>) {
    return mockClient({
      listSnapshots: (options) => {
        calls.push(options);
        if (options?.contains === "alpha") {
          return Promise.resolve({
            items: [makeSnapshot({ id: 41, url: "https://alpha.com" })],
            total: 1,
            page: 1,
            limit: 20,
          });
        }
        if (options?.contains) {
          return Promise.resolve({ items: [], total: 0, page: 1, limit: 20 });
        }
        return Promise.resolve({
          items: [makeSnapshot({ id: 1, url: "https://beta.org" })],
          total: 45,
          page: options?.page ?? 1,
          limit: 20,
        });
      },
    });
  }

  test("finds a snapshot that is not on the page, by asking the server", async () => {
    const calls: Array<ListSnapshotsOptions | undefined> = [];
    renderApp(archiveOf45(calls), "/snapshots");

    await screen.findByText("https://beta.org");
    expect(screen.getByText("45")).toBeTruthy();
    expect(calls.at(-1)?.contains).toBeUndefined();

    fireEvent.change(screen.getByPlaceholderText("Filter by URL or title\u2026"), {
      target: { value: "alpha" },
    });

    await screen.findByText("https://alpha.com");
    expect(screen.queryByText("https://beta.org")).toBeNull();
    // The badge counts the matches in the archive.
    expect(screen.getByTitle("Snapshots matching the filter").textContent).toBe("1");
    expect(calls.at(-1)).toMatchObject({ contains: "alpha", page: 1 });
  });

  test("restores the full list when the filter is cleared", async () => {
    renderApp(archiveOf45([]), "/snapshots");
    await screen.findByText("https://beta.org");

    const input = screen.getByPlaceholderText("Filter by URL or title\u2026");
    fireEvent.change(input, { target: { value: "alpha" } });
    await screen.findByText("https://alpha.com");

    fireEvent.change(input, { target: { value: "" } });
    await screen.findByText("https://beta.org");
    expect(screen.getByTitle("Total snapshots").textContent).toBe("45");
    expect(screen.queryByText("https://alpha.com")).toBeNull();
  });

  test("says so when nothing in the archive matches", async () => {
    renderApp(archiveOf45([]), "/snapshots");
    await screen.findByText("https://beta.org");

    fireEvent.change(screen.getByPlaceholderText("Filter by URL or title\u2026"), {
      target: { value: "zzz-no-match" },
    });

    expect(await screen.findByText("No snapshots match your filter")).toBeTruthy();
    expect(screen.queryByText("No snapshots yet")).toBeNull();
  });

  test("a filter in the address is applied on load; Enter sends a new one from page 1", async () => {
    const calls: Array<ListSnapshotsOptions | undefined> = [];
    renderApp(archiveOf45(calls), "/snapshots?filter=beta-archive&page=2");

    const input = (await screen.findByPlaceholderText(
      "Filter by URL or title\u2026",
    )) as HTMLInputElement;
    expect(input.value).toBe("beta-archive");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toMatchObject({ contains: "beta-archive", page: 2 });

    fireEvent.change(input, { target: { value: "alpha" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("https://alpha.com");
    expect(calls.at(-1)).toMatchObject({ contains: "alpha", page: 1 });
  });
});

// ---------------------------------------------------------------------------
// SearchPage — the filters are answered by the server
// ---------------------------------------------------------------------------

describe("limits shared with the server", () => {
  test("the snapshot filter takes at most the 200 characters the server accepts", async () => {
    const calls: Array<ListSnapshotsOptions | undefined> = [];
    renderApp(
      mockClient({
        listSnapshots: (options) => {
          calls.push(options);
          return Promise.resolve(snapshotPage([]));
        },
      }),
      `/snapshots?filter=${"a".repeat(300)}`,
    );
    const input = (await screen.findByPlaceholderText(
      "Filter by URL or title\u2026",
    )) as HTMLInputElement;
    expect(input.maxLength).toBe(200);
    fireEvent.change(input, { target: { value: "b".repeat(300) } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls.at(-1)?.contains).toBe("b".repeat(200)));
  });

  test("a search page past the end steps back to the last page", async () => {
    const pages: number[] = [];
    renderApp(
      mockClient({
        searchSnapshotsPage: (_q, options) => {
          pages.push(options?.page ?? 1);
          const page = options?.page ?? 1;
          return Promise.resolve({
            items:
              page <= 2
                ? [
                    {
                      id: 1,
                      url: "https://a.example",
                      snippet: "",
                      rank: 0,
                      status: "done",
                      createdAt: "",
                      title: "On the last page",
                      extractors: [],
                      tags: [],
                    },
                  ]
                : [],
            total: 30,
            page,
            limit: 20,
          } as unknown as SearchPage);
        },
      }),
      "/search?q=ice&page=98",
    );
    expect(await screen.findByText("On the last page")).toBeTruthy();
    expect(pages).toContain(98);
    expect(pages.at(-1)).toBe(2);
  });
});

describe("SearchPage — filters", () => {
  type Call = { query: string; options: SearchSnapshotsOptions | undefined };

  function hit(id: number, title: string) {
    return {
      id,
      url: `https://example.com/${id}`,
      snippet: "ice",
      rank: -1,
      status: "done" as const,
      createdAt: "2026-01-15T10:00:00Z",
      title,
      extractors: [],
      tags: [],
    };
  }

  /** 60 hits for the query; 1 of them, on no particular page, is a failed snapshot. */
  function searchClient(calls: Call[]) {
    return mockClient({
      searchSnapshotsPage: (query, options) => {
        calls.push({ query, options });
        const failedOnly = [options?.status].flat().includes("failed");
        return Promise.resolve({
          items: failedOnly ? [hit(57, "The failed one")] : [hit(1, "First of many")],
          total: failedOnly ? 1 : 60,
          page: options?.page ?? 1,
          limit: 20,
        } as unknown as SearchPage);
      },
    });
  }

  test("a filter is sent to the server and counts the whole archive", async () => {
    const calls: Call[] = [];
    renderApp(searchClient(calls), "/search?q=ice&page=3");

    await screen.findByText("First of many");
    expect(screen.getByText("60 results")).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({ query: "ice", options: { page: 3 } });
    expect(calls.at(-1)?.options?.status).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "failed" }));

    // The failed hit was on none of the loaded pages: only the server can return it.
    await screen.findByText("The failed one");
    expect(screen.getByText("1 result matches the filters")).toBeTruthy();
    expect(calls.at(-1)).toMatchObject({ query: "ice", options: { status: ["failed"], page: 1 } });
    expect(screen.queryByText(/current page of results only/)).toBeNull();
  });

  test("filters in the address are applied on load", async () => {
    const calls: Call[] = [];
    renderApp(searchClient(calls), "/search?q=ice&status=done,failed&extractor=pdf&tag=3&days=30");

    await screen.findByText("The failed one");
    const options = calls.at(-1)?.options;
    expect(options).toMatchObject({ status: ["done", "failed"], extractors: ["pdf"], tags: [3] });
    expect(options?.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByRole("button", { name: "pdf" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Last 30 days" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /Clear all/ }));
    await screen.findByText("First of many");
    expect(calls.at(-1)?.options).toEqual({ page: 1, limit: 20 });
  });
});

// ---------------------------------------------------------------------------
// DetailPage — Flow 2: Snapshot Detail View
// ---------------------------------------------------------------------------

describe("DetailPage — renders results", () => {
  test("displays snapshot URL", async () => {
    const detail = makeDetail({ id: 5, url: "https://detail-test.com" });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/5");

    const link = await screen.findByRole("link", { name: /detail-test\.com/ });
    expect(link).toBeTruthy();
  });

  test("shows archive result sections", async () => {
    const detail = makeDetail({
      id: 7,
      url: "https://archive-test.com",
      archiveResults: [
        {
          id: 10,
          extractor: "warc",
          downloadUrl: "/api/v1/snapshots/1/archives/warc/download",
          previewUrl: null,
          content: null,
          createdAt: "2024-01-15T10:01:00.000Z",
        },
        {
          id: 11,
          extractor: "pdf",
          content: null,
          downloadUrl: "/api/v1/snapshots/7/archives/pdf/download",
          previewUrl: null,
          createdAt: "2024-01-15T10:02:00Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/7");
    await openDetails();

    await screen.findAllByRole("link", { name: /archive-test\.com/ });
    expect(screen.getAllByText("warc").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pdf").length).toBeGreaterThan(0);
  });

  test("links each archive file to the downloadUrl the API gives it", async () => {
    // A server behind a reverse-proxy path: the URL must come from the result, not be rebuilt.
    const pdfUrl = "https://wf.example/base/api/v1/snapshots/12/archives/pdf/download";
    const detail = makeDetail({
      id: 12,
      url: "https://links.example",
      archiveResults: [
        {
          id: 30,
          extractor: "pdf",
          content: null,
          downloadUrl: pdfUrl,
          previewUrl: null,
          createdAt: "2024-01-15T10:02:00Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/12");

    fireEvent.click(await screen.findByRole("tab", { name: /Files/ }));
    const link = await screen.findByRole("link", { name: /PDF/ });
    expect(link.getAttribute("href")).toBe(pdfUrl);
  });

  test("opens on the archived page, filling the window, with its details closed", async () => {
    const previewUrl = "/api/v1/snapshots/13/archives/singlefile/preview";
    const detail = makeDetail({
      id: 13,
      url: "https://page.example",
      archiveResults: [
        {
          id: 40,
          extractor: "singlefile",
          content: null,
          downloadUrl: "/api/v1/snapshots/13/archives/singlefile/download",
          previewUrl,
          createdAt: "2024-01-15T10:02:00Z",
        },
        {
          id: 41,
          extractor: "readability",
          content: JSON.stringify({ title: "T", textContent: "x" }),
          downloadUrl: "/api/v1/snapshots/13/archives/readability/download",
          previewUrl: null,
          createdAt: "2024-01-15T10:02:00Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/13");

    const page = await screen.findByRole("tab", { name: /Page/ });
    expect(page.getAttribute("aria-selected")).toBe("true");
    const frame = screen.getByTitle("Archived page preview");
    expect(frame.getAttribute("src")).toBe(previewUrl);
    expect(frame.getAttribute("sandbox")).toBe("");
    const open = screen.getByRole("link", { name: "Open the archived page in a new tab" });
    expect(open.getAttribute("href")).toBe(previewUrl);
    expect(open.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("button", { name: "Full screen" })).toBeTruthy();
    // No app sidebar and nothing beside the page: it has the window.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Extractors")).toBeNull();

    // Details is a view of its own, in place of the page.
    fireEvent.click(screen.getByRole("tab", { name: /Details/ }));
    expect(screen.getByText("Extractors")).toBeTruthy();
    expect(screen.queryByTitle("Archived page preview")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to snapshots" }));
    await screen.findByRole("heading", { name: "Snapshots" });
  });

  test("a view picked while the snapshot loads is kept when it arrives", async () => {
    // media would make Media the default view; the reader asked for Details first.
    const detail = makeDetail({
      id: 15,
      archiveResults: [
        {
          id: 50,
          extractor: "media",
          content: null,
          downloadUrl: "/api/v1/snapshots/15/archives/media/download",
          previewUrl: null,
          createdAt: "2024-01-15T10:02:00Z",
        },
      ],
    });
    let arrive: (d: typeof detail) => void = () => {};
    const client = mockClient({
      getSnapshot: () =>
        new Promise((resolve) => {
          arrive = resolve;
        }),
    });
    renderApp(client, "/snapshots/15");

    fireEvent.click(await screen.findByRole("tab", { name: /Details/ }));
    expect(screen.getByRole("status", { name: "Loading snapshot" })).toBeTruthy();
    arrive(detail);
    await screen.findByText("Extractors");
    expect(screen.getByRole("tab", { name: /Details/ }).getAttribute("aria-selected")).toBe("true");
  });

  test("the old ?detail= address opens the viewer", async () => {
    const detail = makeDetail({ id: 14, url: "https://legacy.example" });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots?detail=14");
    await screen.findByRole("button", { name: "Back to snapshots" });
    expect(screen.getByRole("link", { name: /legacy\.example/ })).toBeTruthy();
  });

  test("shows fallback when archiveResults is empty", async () => {
    const detail = makeDetail({ id: 8, url: "https://empty.com", archiveResults: [] });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/8");
    await openDetails();

    await screen.findAllByRole("link", { name: /empty\.com/ });
    expect(screen.getByText("None yet")).toBeTruthy();
  });

  test("renders the readability result with title, byline and text", async () => {
    const readabilityContent = JSON.stringify({
      title: "Test Article Title",
      byline: "By Test Author",
      excerpt: "This is the excerpt.",
      textContent: "Full text content here.",
    });
    const detail = makeDetail({
      id: 9,
      url: "https://readable.com",
      archiveResults: [
        {
          id: 20,
          extractor: "readability",
          downloadUrl: "/api/v1/snapshots/1/archives/readability/download",
          previewUrl: null,
          content: readabilityContent,
          createdAt: "2024-01-15T10:03:00.000Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/9");

    await screen.findByRole("link", { name: /readable\.com/ });
    expect(screen.getByText("Test Article Title")).toBeTruthy();
    expect(screen.getByText("By Test Author")).toBeTruthy();
    expect(screen.getByText("Full text content here.")).toBeTruthy();
  });
});

describe("DetailPage — 404 / error state", () => {
  test("shows error message when snapshot is not found (null)", async () => {
    const client = mockClient({ getSnapshot: () => Promise.resolve(null) });
    renderApp(client, "/snapshots/999");

    const err = await screen.findByText("Snapshot not found.");
    expect(err).toBeTruthy();
  });
});

describe("Reader tab", () => {
  test("renders textContent from the real readability shape as plain-text paragraphs", async () => {
    const detail = makeDetail({
      id: 30,
      url: "https://reader.test",
      extractors: ["readability"],
      archiveResults: [
        {
          id: 40,
          extractor: "readability",
          downloadUrl: "/api/v1/snapshots/1/archives/readability/download",
          previewUrl: null,
          content: JSON.stringify({
            title: "Reader Title",
            byline: "By Someone",
            textContent: "First paragraph.\n\nSecond <b>paragraph</b>.",
            excerpt: null,
          }),
          createdAt: "2024-01-15T10:03:00.000Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    const { container } = renderApp(client, "/snapshots/30");
    fireEvent.click(await screen.findByRole("tab", { name: /Reader/ }));

    await screen.findByText("First paragraph.");
    expect(screen.getByText("Reader Title")).toBeTruthy();
    expect(screen.getByText("By Someone")).toBeTruthy();
    expect(screen.getByText("Second <b>paragraph</b>.")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("Auth bootstrap", () => {
  test("asks for the setup status and the session at once, not one after the other", async () => {
    let releaseStatus: (v: { needsSetup: boolean }) => void = () => {};
    let meCalled = false;
    const client = mockClient({});
    (client as unknown as { getSetupStatus: () => Promise<unknown> }).getSetupStatus = () =>
      new Promise((r) => {
        releaseStatus = r;
      });
    (client as unknown as { getMe: () => Promise<unknown> }).getMe = () => {
      meCalled = true;
      return Promise.resolve({ username: "admin" });
    };
    renderApp(client, "/");
    // The status has not answered yet, and the session check is already out.
    await waitFor(() => expect(meCalled).toBe(true));
    releaseStatus({ needsSetup: false });
    await screen.findByRole("heading", { name: "Dashboard" });
  });
});

describe("Auth bootstrap failures", () => {
  test("a failing status check shows the unreachable screen, not the login form", async () => {
    let calls = 0;
    const client = mockClient({});
    (client as unknown as { getSetupStatus: () => Promise<unknown> }).getSetupStatus = () => {
      calls++;
      return calls === 1
        ? Promise.reject(new WebFrostError(500, "boom"))
        : Promise.resolve({ needsSetup: false });
    };
    renderApp(client, "/");

    await screen.findByText("Can't reach the WebFrost server");
    expect(screen.queryByText("Sign in to continue")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Dashboard" });
  });

  test("a 503 from getMe also shows the unreachable screen", async () => {
    const client = mockClient({});
    (client as unknown as { getMe: () => Promise<unknown> }).getMe = () =>
      Promise.reject(new WebFrostError(503, "down"));
    renderApp(client, "/");
    await screen.findByText("Can't reach the WebFrost server");
  });
});

describe("ListPage — failures are not empty", () => {
  test("a failed snapshot query shows an error with Retry instead of the empty state", async () => {
    let fail = true;
    const client = mockClient({
      listSnapshots: () =>
        fail
          ? Promise.reject(new WebFrostError(500, "db down"))
          : Promise.resolve(snapshotPage([makeSnapshot({ url: "https://back.example" })])),
    });
    renderApp(client, "/snapshots");

    await screen.findByText("Could not load snapshots", {}, { timeout: 3000 });
    expect(screen.queryByText("No snapshots yet")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("https://back.example");
  });

  test("a malformed ?detail= opens no panel", async () => {
    const client = mockClient({
      listSnapshots: () => Promise.resolve(snapshotPage([makeSnapshot({ id: 1 })])),
    });
    renderApp(client, "/snapshots?detail=abc");
    await screen.findByText("https://example.com");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Snapshot list layouts and shortcuts", () => {
  test("the cards layout shows a card per snapshot and is remembered", async () => {
    localStorage.removeItem("webfrost-snapshot-density");
    const client = mockClient({
      listSnapshots: () =>
        Promise.resolve(snapshotPage([makeSnapshot({ id: 3, url: "https://cards.example" })])),
    });
    renderApp(client, "/snapshots");
    await screen.findByText("https://cards.example");

    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    const card = screen.getByRole("link", { name: /cards\.example/ });
    expect(card.getAttribute("href")).toBe("/snapshots/3");
    expect(card.closest("ul")?.className).toContain("grid");
    expect(localStorage.getItem("webfrost-snapshot-density")).toBe("grid");
    localStorage.removeItem("webfrost-snapshot-density");
  });

  test("/ focuses the page's filter and Ctrl+B collapses the sidebar", async () => {
    localStorage.removeItem("webfrost-sidebar-collapsed");
    const client = mockClient({
      listSnapshots: () => Promise.resolve(snapshotPage([makeSnapshot({ id: 1 })])),
    });
    renderApp(client, "/snapshots");
    await screen.findByText("https://example.com");

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByLabelText("Filter snapshots by URL or title"));

    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(localStorage.getItem("webfrost-sidebar-collapsed")).toBe("true");
    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(localStorage.getItem("webfrost-sidebar-collapsed")).toBe("false");
  });
});

describe("Archiving in the app's theme and video snapshots", () => {
  test("a new snapshot is archived in the app's current theme", async () => {
    localStorage.setItem("webfrost-theme", "dark");
    const calls: Array<{ url: string; colorScheme: string | undefined }> = [];
    const client = mockClient({
      createSnapshot: (url, options) => {
        calls.push({ url, colorScheme: options?.colorScheme });
        return Promise.resolve({ id: 2, url, status: "pending" });
      },
    });
    renderApp(client, "/snapshots");

    fireEvent.click(await screen.findByRole("button", { name: /New Snapshot/ }));
    const dialog = screen.getByRole("dialog", { name: "Archive a URL" });
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: "https://dark.example" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: "https://dark.example/", colorScheme: "dark" });
    localStorage.removeItem("webfrost-theme");
  });

  test("a snapshot with a video opens on Media, not on the archived page", async () => {
    const detail = makeDetail({
      id: 21,
      url: "https://video.example/watch",
      archiveResults: [
        {
          id: 50,
          extractor: "singlefile",
          content: null,
          downloadUrl: "/api/v1/snapshots/21/archives/singlefile/download",
          previewUrl: "/api/v1/snapshots/21/archives/singlefile/preview",
          createdAt: "2024-01-15T10:02:00Z",
        },
        {
          id: 51,
          extractor: "media",
          content: null,
          downloadUrl: "/api/v1/snapshots/21/archives/media/download",
          previewUrl: null,
          createdAt: "2024-01-15T10:02:00Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/21");

    const media = await screen.findByRole("tab", { name: /Media/ });
    await waitFor(() => expect(media.getAttribute("aria-selected")).toBe("true"));
  });

  test("the video player shows the poster still when there is one", async () => {
    const result = (id: number, extractor: string, path: string) => ({
      id,
      extractor,
      content: null,
      downloadUrl: `/api/v1/snapshots/22/archives/${path}/download`,
      previewUrl: null,
      createdAt: "2024-01-15T10:02:00Z",
    });
    const withPoster = makeDetail({
      id: 22,
      archiveResults: [result(60, "media", "media"), result(61, "media-poster", "media-poster")],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(withPoster) });
    const { container } = renderApp(client, "/snapshots/22");
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(container.querySelector("video")?.getAttribute("poster")).toBe(
      "/api/v1/snapshots/22/archives/media-poster/download",
    );
  });

  test("the video has no poster attribute without a media-poster result", async () => {
    const detail = makeDetail({
      id: 23,
      archiveResults: [
        {
          id: 70,
          extractor: "media",
          content: null,
          downloadUrl: "/api/v1/snapshots/23/archives/media/download",
          previewUrl: null,
          createdAt: "2024-01-15T10:02:00Z",
        },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    const { container } = renderApp(client, "/snapshots/23");
    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(container.querySelector("video")?.hasAttribute("poster")).toBe(false);
  });
});

describe("Global 401 handling", () => {
  test("a query failing with 401 redirects to /login", async () => {
    const client = mockClient({
      listSnapshots: () => Promise.reject(new WebFrostError(401, "Unauthorized")),
    });
    renderApp(client, "/snapshots");

    await screen.findByText("Sign in to continue");
  });
});

describe("SnapshotViewer — Archive again", () => {
  test("Details offers Archive again; clicking retries that snapshot and the page shows it archiving", async () => {
    let status: SnapshotDetail["status"] = "done";
    const retried: number[] = [];
    const client = mockClient({
      getSnapshot: () => Promise.resolve(makeDetail({ id: 7, status })),
      retrySnapshot: (id) => {
        retried.push(id);
        status = "pending";
        return Promise.resolve({ id, status: "pending" as const });
      },
    });
    renderApp(client, "/snapshots/7");
    await openDetails();

    const button = await screen.findByRole("button", { name: "Archive again" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => expect(retried).toEqual([7]));
    const archiving = await screen.findByRole("button", { name: "Archiving…" });
    expect((archiving as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Archive again" })).toBeNull();
  });

  test("while the snapshot is pending the button is disabled and reads Archiving…", async () => {
    const retried: number[] = [];
    const client = mockClient({
      getSnapshot: () => Promise.resolve(makeDetail({ id: 8, status: "pending" })),
      retrySnapshot: (id) => {
        retried.push(id);
        return Promise.resolve({ id, status: "pending" as const });
      },
    });
    renderApp(client, "/snapshots/8");
    await openDetails();

    const button = (await screen.findByRole("button", { name: "Archiving…" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(retried).toEqual([]);
  });
});
