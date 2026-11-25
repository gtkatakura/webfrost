/**
 * Connecting a command line to this server without copying an API key by hand, modelled on the
 * OAuth 2.0 Device Authorization Grant (RFC 8628):
 *
 *   1. The CLI asks for a request (`start`). It gets a secret `deviceCode`, which it keeps, and a
 *      short `userCode`, which it shows.
 *   2. The person opens the web UI, signed in, sees the same code and what is asking, and
 *      approves or denies (`approve`, `deny`).
 *   3. The CLI polls with its `deviceCode` (`collect`). Once approved, the first poll is told so,
 *      exactly once, and the route creates an API key for it.
 *
 * Nothing here is a credential until step 3: a request is a slot in memory that expires after a
 * few minutes. No API key exists before the approval, and the key is never stored in plain text:
 * it is created at the poll that returns it. A server restart forgets pending requests; the CLI
 * is told its request is gone and the person runs the command again.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";

/** How long a request waits for an answer. */
export const DEVICE_REQUEST_TTL_MS = 10 * 60_000;
/** How often the CLI should poll, in seconds. */
export const DEVICE_POLL_INTERVAL_SECONDS = 2;
/** Requests held at once, over all clients: memory stays bounded whatever arrives. */
export const MAX_DEVICE_REQUESTS = 200;
/**
 * Requests one address may have waiting. Starting one costs nothing and needs no credentials, so
 * without this a single client could hold every slot and keep everyone else from connecting.
 */
export const MAX_DEVICE_REQUESTS_PER_CLIENT = 5;

/**
 * Letters of a user code: no vowels (no words by accident) and none of the pairs people confuse
 * when reading aloud or copying by hand. 20 letters, as RFC 8628 section 6.1 suggests.
 */
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

export type DeviceRequestStatus = "pending" | "approved" | "denied";

/** What the person approving sees about a request. */
export interface DeviceRequest {
  /** The code as shown: `WDJB-MJHT`. */
  userCode: string;
  /** The name the CLI gave itself; it becomes the API key's name. Untrusted text. */
  name: string;
  /** The address the request came from, as the server saw it. */
  requesterIp: string;
  status: DeviceRequestStatus;
  requestedAt: number;
  expiresAt: number;
}

interface Entry extends DeviceRequest {
  deviceCodeHash: string;
}

export type CollectResult =
  | { status: "pending" }
  | { status: "denied" }
  /** Approved: the caller creates the API key now. Returned once; the request is gone after it. */
  | { status: "approved"; name: string }
  /** No such request: never existed, expired, already collected, or the server restarted. */
  | { status: "unknown" };

function hashDeviceCode(deviceCode: string): string {
  return createHash("sha256").update(deviceCode).digest("hex");
}

/** A user code without its dash, spaces or lower case: what is compared. */
export function normalizeUserCode(input: string): string {
  return input.replace(/[^a-zA-Z]/g, "").toUpperCase();
}

function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function randomUserCode(): string {
  let code = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Who a request counts against: its address, or for IPv6 its /48 (the rate limiter's keys are /64s,
 * and one customer of a provider usually holds a /56 or a /48, so 256 or more of them).
 */
export function clientBucket(requesterIp: string): string {
  const v6 = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/i.exec(requesterIp);
  return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : requesterIp;
}

export class DeviceAuthStore {
  private readonly byUserCode = new Map<string, Entry>();
  private readonly byDeviceCode = new Map<string, Entry>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      maxRequests?: number;
      maxPerClient?: number;
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private forget(entry: Entry): void {
    this.byUserCode.delete(normalizeUserCode(entry.userCode));
    this.byDeviceCode.delete(entry.deviceCodeHash);
  }

  private dropExpired(): void {
    const now = this.now();
    for (const entry of this.byUserCode.values()) {
      if (entry.expiresAt <= now) this.forget(entry);
    }
  }

  /** The request that has waited longest among `entries`, or undefined when there is none. */
  private static oldest(entries: Iterable<Entry>): Entry | undefined {
    let found: Entry | undefined;
    for (const entry of entries) {
      if (!found || entry.requestedAt < found.requestedAt) found = entry;
    }
    return found;
  }

  /**
   * A new request. The device code is returned here and nowhere else; only its hash is kept.
   *
   * It always gets a slot: when the client already has as many requests as it may, or the store
   * is full, the oldest one makes room (the client's own first). So nobody can keep others from
   * connecting by starting requests: the newest request, the one a person is about to approve,
   * is the last to go.
   */
  start(input: { name: string; requesterIp: string }): {
    deviceCode: string;
    userCode: string;
    expiresIn: number;
    interval: number;
  } {
    this.dropExpired();
    // Only requests still waiting for an answer make room. One a person has approved is about
    // to be collected by its command line: dropping it would fail a login after the approval.
    const waiting = [...this.byUserCode.values()].filter((e) => e.status === "pending");
    const mine = waiting.filter(
      (e) => clientBucket(e.requesterIp) === clientBucket(input.requesterIp),
    );
    if (mine.length >= (this.options.maxPerClient ?? MAX_DEVICE_REQUESTS_PER_CLIENT)) {
      const oldest = DeviceAuthStore.oldest(mine);
      if (oldest) this.forget(oldest);
    }
    if (this.byUserCode.size >= (this.options.maxRequests ?? MAX_DEVICE_REQUESTS)) {
      // The client with the most requests waiting gives one up (its oldest): someone holding many
      // addresses fills the store with theirs, so they are the ones who lose them, never a person
      // with the one request they are approving. Answered ones go only when nothing else can.
      const byClient = new Map<string, Entry[]>();
      for (const e of waiting) {
        const key = clientBucket(e.requesterIp);
        const list = byClient.get(key);
        if (list) list.push(e);
        else byClient.set(key, [e]);
      }
      let fullest: Entry[] = [];
      for (const list of byClient.values()) {
        if (list.length > fullest.length) fullest = list;
      }
      const oldest =
        DeviceAuthStore.oldest(fullest) ?? DeviceAuthStore.oldest(this.byUserCode.values());
      if (oldest) this.forget(oldest);
    }

    let code = randomUserCode();
    while (this.byUserCode.has(code)) code = randomUserCode();
    const deviceCode = randomBytes(32).toString("hex");
    const ttlMs = this.options.ttlMs ?? DEVICE_REQUEST_TTL_MS;
    const now = this.now();
    const entry: Entry = {
      userCode: formatUserCode(code),
      name: input.name,
      requesterIp: input.requesterIp,
      status: "pending",
      requestedAt: now,
      expiresAt: now + ttlMs,
      deviceCodeHash: hashDeviceCode(deviceCode),
    };
    this.byUserCode.set(code, entry);
    this.byDeviceCode.set(entry.deviceCodeHash, entry);
    return {
      deviceCode,
      userCode: entry.userCode,
      expiresIn: Math.round(ttlMs / 1000),
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    };
  }

  /** The request a user code names, for the approval screen. Null when there is none (any more). */
  find(userCode: string): DeviceRequest | null {
    this.dropExpired();
    const entry = this.byUserCode.get(normalizeUserCode(userCode));
    if (!entry) return null;
    const { deviceCodeHash: _hash, ...request } = entry;
    return request;
  }

  /** Answer a pending request. False when there is none, or it was answered already. */
  private answer(userCode: string, status: "approved" | "denied"): boolean {
    this.dropExpired();
    const entry = this.byUserCode.get(normalizeUserCode(userCode));
    if (!entry || entry.status !== "pending") return false;
    entry.status = status;
    return true;
  }

  approve(userCode: string): boolean {
    return this.answer(userCode, "approved");
  }

  deny(userCode: string): boolean {
    return this.answer(userCode, "denied");
  }

  /**
   * What the CLI's poll learns. An answer (approved or denied) is given once: the request is
   * removed with it, so a device code that leaks later is worth nothing.
   */
  collect(deviceCode: string): CollectResult {
    this.dropExpired();
    const entry = this.byDeviceCode.get(hashDeviceCode(deviceCode));
    if (!entry) return { status: "unknown" };
    if (entry.status === "pending") return { status: "pending" };
    this.forget(entry);
    return entry.status === "approved"
      ? { status: "approved", name: entry.name }
      : { status: "denied" };
  }

  /** Requests waiting or answered but not collected yet. */
  get size(): number {
    this.dropExpired();
    return this.byUserCode.size;
  }
}

/** The process's store: requests live in memory, like the rate limiter's counters. */
export const deviceAuth = new DeviceAuthStore();
