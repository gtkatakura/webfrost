import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Snapshot, SnapshotCreated, SnapshotDetail, WebFrostClient } from "@webfrost/sdk";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function mockClient(overrides: {
  listSnapshots?: () => Promise<Snapshot[]>;
  createSnapshot?: (url: string) => Promise<SnapshotCreated>;
  getSnapshot?: (id: number) => Promise<SnapshotDetail | null>;
}): WebFrostClient {
  return {
    listSnapshots: () => Promise.resolve([]),
    createSnapshot: (url: string) => Promise.resolve({ id: 1, url, status: "pending" }),
    getSnapshot: () => Promise.resolve(null),
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
    archiveResults: [],
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
    const client = mockClient({ listSnapshots: () => Promise.resolve([]) });
    renderApp(client);

    const msg = await screen.findByText("No snapshots yet. Archive a URL above.");
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
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshots) });
    renderApp(client);

    await screen.findByText("https://alpha.com");
    expect(screen.getByText("https://beta.org")).toBeTruthy();
    expect(screen.getByText("https://gamma.io")).toBeTruthy();
  });

  test("renders status badges for each snapshot", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://done.com", status: "done" }),
      makeSnapshot({ id: 2, url: "https://pending.com", status: "pending" }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshots) });
    renderApp(client);

    await screen.findByText("https://done.com");
    expect(screen.getAllByText("done").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pending").length).toBeGreaterThan(0);
  });

  test("rows link to detail view", async () => {
    const client = mockClient({
      listSnapshots: () => Promise.resolve([makeSnapshot({ id: 42, url: "https://example.com" })]),
    });
    renderApp(client);

    await screen.findByText("https://example.com");
    const link = screen.getByRole("link", { name: /example\.com/ });
    expect(link.getAttribute("href")).toContain("/snapshots/42");
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
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshots) });
    renderApp(client);

    await screen.findByText("https://alpha.com");

    const searchInput = screen.getByPlaceholderText("Filter by URL\u2026");
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    expect(screen.getByText("https://alpha.com")).toBeTruthy();
    expect(screen.queryByText("https://beta.org")).toBeNull();
  });

  test("restores full list when search is cleared", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://alpha.com" }),
      makeSnapshot({ id: 2, url: "https://beta.org" }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshots) });
    renderApp(client);

    await screen.findByText("https://alpha.com");

    const searchInput = screen.getByPlaceholderText("Filter by URL\u2026");
    fireEvent.change(searchInput, { target: { value: "alpha" } });
    expect(screen.queryByText("https://beta.org")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByText("https://beta.org")).toBeTruthy();
  });

  test("shows no-match message when filter returns no results", async () => {
    const snapshots = [makeSnapshot({ id: 1, url: "https://alpha.com" })];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshots) });
    renderApp(client);

    await screen.findByText("https://alpha.com");

    const searchInput = screen.getByPlaceholderText("Filter by URL\u2026");
    fireEvent.change(searchInput, { target: { value: "zzz-no-match" } });

    expect(screen.getByText("No snapshots match your filters.")).toBeTruthy();
  });

  test("filters by extractor checkbox", async () => {
    const snapshots = [
      makeSnapshot({ id: 1, url: "https://with-warc.com", extractors: ["warc"] }),
      makeSnapshot({ id: 2, url: "https://no-warc.com", extractors: [] }),
    ];
    const client = mockClient({ listSnapshots: () => Promise.resolve(snapshots) });
    renderApp(client);

    await screen.findByText("https://with-warc.com");

    const warcCheckbox = screen.getByRole("checkbox", { name: /warc/ });
    fireEvent.click(warcCheckbox);

    expect(screen.getByText("https://with-warc.com")).toBeTruthy();
    expect(screen.queryByText("https://no-warc.com")).toBeNull();
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
    expect(screen.getByText("No extractor results yet.")).toBeTruthy();
  });

  test("renders readability result with title and excerpt", async () => {
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
    expect(screen.getByText("This is the excerpt.")).toBeTruthy();
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
