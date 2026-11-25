import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DeviceRequest, WebFrostClient } from "@webfrost/sdk";
import { WebFrostError } from "@webfrost/sdk";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { ClientContext } from "../context";
import { ConnectPage } from "./ConnectPage";

afterEach(() => cleanup());

const REQUEST: DeviceRequest = {
  userCode: "WDJB-MJHT",
  name: "webfrost CLI on laptop",
  requesterIp: "203.0.113.7",
  status: "pending",
  requestedAt: "2026-11-24T10:00:00Z",
  expiresAt: "2026-11-24T10:10:00Z",
};

/** A server holding one pending request; it records what the page asked it to do. */
function server(request: DeviceRequest | null = REQUEST) {
  const calls: string[] = [];
  const client: Partial<WebFrostClient> = {
    getDeviceRequest: (code) => {
      calls.push(`get ${code}`);
      return Promise.resolve(request && code === request.userCode ? request : null);
    },
    approveDeviceRequest: (code) => {
      calls.push(`approve ${code}`);
      return Promise.resolve(true);
    },
    denyDeviceRequest: (code) => {
      calls.push(`deny ${code}`);
      return Promise.resolve(true);
    },
  };
  return { client, calls };
}

function renderAt(path: string, client: Partial<WebFrostClient>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={client as WebFrostClient}>
        <MemoryRouter initialEntries={[path]}>
          <ConnectPage />
        </MemoryRouter>
      </ClientContext.Provider>
    </QueryClientProvider>,
  );
}

describe("ConnectPage", () => {
  test("shows what is asking, with the code to compare, and approves it", async () => {
    const { client, calls } = server();
    renderAt("/connect?code=WDJB-MJHT", client);

    expect((await screen.findByTestId("device-code")).textContent).toBe("WDJB-MJHT");
    expect(screen.getByText("webfrost CLI on laptop")).toBeTruthy();
    expect(screen.getByText("203.0.113.7")).toBeTruthy();
    // Nothing is approved by opening the link: it takes the click.
    expect(calls).toEqual(["get WDJB-MJHT"]);

    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(calls).toEqual(["get WDJB-MJHT", "approve WDJB-MJHT"]);
    expect(screen.getByRole("link", { name: "Settings, API keys" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  test("deny creates nothing and says so", async () => {
    const { client, calls } = server();
    renderAt("/connect?code=WDJB-MJHT", client);

    fireEvent.click(await screen.findByRole("button", { name: /Deny/ }));
    expect(await screen.findByText("Request denied")).toBeTruthy();
    expect(calls).toEqual(["get WDJB-MJHT", "deny WDJB-MJHT"]);
  });

  test("without a code in the address it asks for one, as people type it", async () => {
    const { client, calls } = server();
    renderAt("/connect", client);

    const input = screen.getByLabelText("Code from the terminal") as HTMLInputElement;
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(input, { target: { value: "wdjb mjht" } });
    expect(input.value).toBe("WDJB-MJHT");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect((await screen.findByTestId("device-code")).textContent).toBe("WDJB-MJHT");
    expect(calls).toEqual(["get WDJB-MJHT"]);
  });

  test("an unknown or expired code offers to enter another, and never an Approve button", async () => {
    const { client } = server(null);
    renderAt("/connect?code=BCDF-GHJK", client);

    expect(await screen.findByText("No request with this code")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enter another code" }));
    expect(screen.getByLabelText("Code from the terminal")).toBeTruthy();
  });

  test("a request that expired while the page was open is reported, not shown as connected", async () => {
    const { client } = server();
    client.approveDeviceRequest = () => Promise.resolve(false);
    renderAt("/connect?code=WDJB-MJHT", client);

    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("expired");
    expect(screen.queryByText("Connected")).toBeNull();
  });
});

describe("the link from webfrost login, opened signed out", () => {
  test("goes through the sign-in and comes back to the request", async () => {
    const { client } = server();
    let signedIn = false;
    const app = {
      ...client,
      getSetupStatus: () => Promise.resolve({ needsSetup: false, publicRead: false }),
      getMe: () =>
        signedIn
          ? Promise.resolve({ username: "admin" })
          : Promise.reject(new WebFrostError(401, "unauthorized")),
      login: () => {
        signedIn = true;
        return Promise.resolve({ ok: true });
      },
      logout: () => Promise.resolve(),
      getStats: () => Promise.reject(new Error("not asked in this test")),
      listSnapshots: () => Promise.resolve({ items: [], total: 0, page: 1, limit: 20 }),
      iterateTags: async function* () {
        yield* [];
      },
    } as unknown as WebFrostClient;

    render(
      <MemoryRouter initialEntries={["/connect?code=WDJB-MJHT"]}>
        <App client={app} />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/Username/), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));

    await waitFor(async () =>
      expect((await screen.findByTestId("device-code")).textContent).toBe("WDJB-MJHT"),
    );
  });
});
