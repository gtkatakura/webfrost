import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  DashboardStats,
  Snapshot,
  SnapshotDetail,
  SnapshotPage,
  Tag,
  WebFrostClient,
} from "@webfrost/sdk";
import { WebFrostError } from "@webfrost/sdk";
import { MemoryRouter } from "react-router-dom";
import App from "./App";

afterEach(() => {
  cleanup();
});

const stats: DashboardStats = {
  snapshotCount: 0,
  storageBytes: 0,
  storageByExtractor: {},
  successRate: 100,
  activeScheduleCount: 0,
  failedToday: 0,
};

const alpha: Tag = { id: 1, name: "alpha-tag", color: "#ff0000" } as Tag;
const beta: Tag = { id: 2, name: "beta-tag", color: "#00ff00" } as Tag;

function snapshot(id: number, url: string): Snapshot {
  return {
    id,
    url,
    status: "done",
    createdAt: "2024-01-15T10:00:00.000Z",
    extractors: [],
    tags: [],
    title: null,
    excerpt: null,
    screenshotUrl: null,
  };
}

function detail(id: number, url: string): SnapshotDetail {
  return { ...snapshot(id, url), archiveResults: [], extractorMeta: {} };
}

interface Opts {
  publicRead: boolean;
  /** true = session valid, false = getMe rejects with 401 */
  signedIn: boolean;
  listSnapshots?: () => Promise<SnapshotPage>;
}

function mockClient({ publicRead, signedIn, listSnapshots }: Opts) {
  const calls: string[] = [];
  const track =
    <T,>(name: string, value: () => Promise<T>) =>
    () => {
      calls.push(name);
      return value();
    };
  const client = {
    getSetupStatus: () => Promise.resolve({ needsSetup: false, publicRead }),
    getMe: () =>
      signedIn
        ? Promise.resolve({ username: "admin" })
        : Promise.reject(new WebFrostError(401, "Unauthorized")),
    login: track("login", () => Promise.resolve({ ok: true })),
    logout: track("logout", () => Promise.resolve()),
    listSnapshots:
      listSnapshots ??
      (() =>
        Promise.resolve({
          items: [snapshot(1, "https://alpha.example"), snapshot(2, "https://beta.example")],
          total: 2,
          page: 1,
          limit: 20,
        })),
    getSnapshot: (id: number) => Promise.resolve(detail(id, "https://detail.example")),
    getStats: () => Promise.resolve(stats),
    listTags: () => Promise.resolve([alpha, beta]),
    listSnapshotTags: () => Promise.resolve([alpha]),
    // Everything below needs credentials; record any call a guest should never make.
    listImports: track("listImports", () => Promise.resolve([])),
    listSchedules: track("listSchedules", () => Promise.resolve([])),
    listApiKeys: track("listApiKeys", () => Promise.resolve([])),
    createSnapshot: track("createSnapshot", () => Promise.resolve({ id: 9 })),
    deleteSnapshot: track("deleteSnapshot", () => Promise.resolve(true)),
    addTagToSnapshot: track("addTagToSnapshot", () => Promise.resolve()),
    removeTagFromSnapshot: track("removeTagFromSnapshot", () => Promise.resolve()),
    createTag: track("createTag", () => Promise.resolve({})),
    deleteTag: track("deleteTag", () => Promise.resolve()),
  } as unknown as WebFrostClient;
  return { client, calls };
}

function renderApp(client: WebFrostClient, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App client={client} />
    </MemoryRouter>,
  );
}

const linkNames = () => screen.queryAllByRole("link").map((l) => l.textContent?.trim());

describe("guest mode (publicRead + no session)", () => {
  test("snapshot list is read-only and the sidebar offers Sign in", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: false });
    renderApp(client, "/snapshots");

    await screen.findByText("https://alpha.example");
    expect(screen.queryByText("New Snapshot")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByText("Delete")).toBeNull();
    expect(screen.queryByLabelText("Select all")).toBeNull();

    expect(screen.getAllByRole("link", { name: /Sign in/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Read-only").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sign out")).toBeNull();
    const names = linkNames();
    for (const hidden of ["Schedules", "Import", "Settings"]) {
      expect(names).not.toContain(hidden);
    }
    expect(names).toContain("Snapshots");
    expect(names).toContain("Tags");
  });

  test("dashboard hides the quick archive form but still shows stats", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: false });
    renderApp(client, "/");

    await screen.findByText("Total Snapshots");
    expect(screen.queryByPlaceholderText(/archive a URL/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
  });

  test.each(["/import", "/schedules", "/settings", "/settings/api-keys"])(
    "%s redirects a guest to the login page without calling protected endpoints",
    async (path) => {
      const { client, calls } = mockClient({ publicRead: true, signedIn: false });
      renderApp(client, path);

      await screen.findByText("Sign in to continue");
      expect(calls).not.toContain("listSchedules");
      expect(calls).not.toContain("listApiKeys");
    },
  );

  test("snapshot detail shows tags without any editing or delete controls", async () => {
    const { client, calls } = mockClient({ publicRead: true, signedIn: false });
    renderApp(client, "/snapshots/5");

    await screen.findByText("alpha-tag");
    expect(screen.queryByLabelText(/Remove tag/)).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/Delete snapshot/)).toBeNull();
    expect(calls).toEqual([]);
  });

  test("tags page lists tags without create form or delete buttons", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: false });
    renderApp(client, "/tags");

    await screen.findByText("alpha-tag");
    expect(screen.queryByPlaceholderText("New tag name")).toBeNull();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  test("a 401 on a protected endpoint keeps the guest where they are", async () => {
    const { client } = mockClient({
      publicRead: true,
      signedIn: false,
      listSnapshots: () => Promise.reject(new WebFrostError(401, "Unauthorized")),
    });
    renderApp(client, "/snapshots");

    await screen.findByRole("heading", { name: "Snapshots" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Sign in to continue")).toBeNull();
    expect(screen.getAllByRole("link", { name: /Sign in/ }).length).toBeGreaterThan(0);
  });

  test("logging in from a redirect returns the user to the page they wanted", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: false });
    renderApp(client, "/import");

    await screen.findByText("Sign in to continue");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByText("Import URLs");
    await waitFor(() => expect(screen.queryByText("Sign in to continue")).toBeNull());
    // Signed in: full navigation is back.
    expect(linkNames()).toContain("Schedules");
  });
});

describe("signed in on a public-read instance", () => {
  test("still sees every write control", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: true });
    renderApp(client, "/snapshots");

    await screen.findByText("https://alpha.example");
    expect(screen.getByText("New Snapshot")).toBeTruthy();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sign out").length).toBeGreaterThan(0);
    expect(screen.queryByText("Read-only")).toBeNull();
    const names = linkNames();
    for (const shown of ["Schedules", "Import", "Settings"]) {
      expect(names).toContain(shown);
    }
  });

  test("detail page keeps tag editing and delete", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: true });
    renderApp(client, "/snapshots/5");

    await screen.findByText("alpha-tag");
    expect(screen.getByLabelText("Remove tag alpha-tag")).toBeTruthy();
    expect(screen.getByText("Delete snapshot")).toBeTruthy();
  });

  test("signing out lands on the dashboard as a guest, not on /login", async () => {
    const { client } = mockClient({ publicRead: true, signedIn: true });
    renderApp(client, "/schedules");

    const [signOut] = await screen.findAllByText("Sign out");
    fireEvent.click(signOut);

    await screen.findByText("Total Snapshots");
    expect(screen.queryByText("Sign in to continue")).toBeNull();
    expect(screen.getAllByText("Read-only").length).toBeGreaterThan(0);
  });
});

describe("private instance (publicRead false)", () => {
  test("a 401 from getMe redirects to the login page", async () => {
    const { client } = mockClient({ publicRead: false, signedIn: false });
    renderApp(client, "/snapshots");

    await screen.findByText("Sign in to continue");
    expect(screen.queryByText("Read-only")).toBeNull();
  });

  test("a missing publicRead field is treated as private", async () => {
    const { client } = mockClient({ publicRead: false, signedIn: false });
    (client as unknown as { getSetupStatus: () => Promise<unknown> }).getSetupStatus = () =>
      Promise.resolve({ needsSetup: false, publicRead: false });
    renderApp(client, "/");
    await screen.findByText("Sign in to continue");
  });
});
