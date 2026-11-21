import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  DashboardStats,
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
import { SnapshotDetailPanel } from "./features/snapshots/detail/SnapshotDetailPanel";

afterEach(() => {
  cleanup();
});

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
  listSnapshots?: () => Promise<SnapshotPage>;
  createSnapshot?: (url: string) => Promise<SnapshotCreated>;
  getSnapshot?: (id: number) => Promise<SnapshotDetail | null>;
  getStats?: () => Promise<DashboardStats>;
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
    listTags: () => Promise.resolve([]),
    listSnapshotTags: () => Promise.resolve([]),
    addTagToSnapshot: () => Promise.resolve(),
    removeTagFromSnapshot: () => Promise.resolve(),
    ...overrides,
  } as unknown as WebFrostClient;
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 1,
    url: "https://example.com",
    status: "done",
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
// ListPage — Flow 3: Search / Filter
// ---------------------------------------------------------------------------

describe("ListPage — search / filter", () => {
  test("filters list by URL search input", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://alpha.com" }),
      makeSnapshot({ id: 2, url: "https://beta.org" }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshotPage(snapshots)) });
    renderApp(client, "/snapshots");

    // Wait for data to load — count badge shows filtered.length
    await screen.findByText("2");

    const searchInput = screen.getByPlaceholderText("Filter by URL or title\u2026");
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    expect(screen.getByText("1")).toBeTruthy();
  });

  test("restores full list when search is cleared", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://alpha.com" }),
      makeSnapshot({ id: 2, url: "https://beta.org" }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshotPage(snapshots)) });
    renderApp(client, "/snapshots");

    await screen.findByText("2");

    const searchInput = screen.getByPlaceholderText("Filter by URL or title\u2026");
    fireEvent.change(searchInput, { target: { value: "alpha" } });
    expect(screen.getByText("1")).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByText("2")).toBeTruthy();
  });

  test("shows no-match message when filter returns no results", async () => {
    const snapshots = [makeSnapshot({ id: 1, url: "https://alpha.com" })];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshotPage(snapshots)) });
    renderApp(client, "/snapshots");

    // Wait for the count badge to confirm data has loaded
    await screen.findByText("1");

    const searchInput = screen.getByPlaceholderText("Filter by URL or title\u2026");
    fireEvent.change(searchInput, { target: { value: "zzz-no-match" } });

    expect(screen.getByText("No results match your filter")).toBeTruthy();
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
          content: "/path/to/file.warc",
          createdAt: "2024-01-15T10:01:00.000Z",
        },
        { id: 11, extractor: "pdf", content: null, createdAt: "2024-01-15T10:02:00.000Z" },
      ],
    });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/7");

    await screen.findByRole("link", { name: /archive-test\.com/ });
    expect(screen.getAllByText("warc").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pdf").length).toBeGreaterThan(0);
  });

  test("shows fallback when archiveResults is empty", async () => {
    const detail = makeDetail({ id: 8, url: "https://empty.com", archiveResults: [] });
    const client = mockClient({ getSnapshot: () => Promise.resolve(detail) });
    renderApp(client, "/snapshots/8");

    await screen.findByRole("link", { name: /empty\.com/ });
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
    const queryClient = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ClientContext.Provider value={client}>
          <MemoryRouter>
            <SnapshotDetailPanel snapshotId={30} onClose={() => {}} onDeleted={async () => {}} />
          </MemoryRouter>
        </ClientContext.Provider>
      </QueryClientProvider>,
    );

    await screen.findByText("First paragraph.");
    expect(screen.getByText("Reader Title")).toBeTruthy();
    expect(screen.getByText("By Someone")).toBeTruthy();
    expect(screen.getByText("Second <b>paragraph</b>.")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
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

describe("Global 401 handling", () => {
  test("a query failing with 401 redirects to /login", async () => {
    const client = mockClient({
      listSnapshots: () => Promise.reject(new WebFrostError(401, "Unauthorized")),
    });
    renderApp(client, "/snapshots");

    await screen.findByText("Sign in to continue");
  });
});
