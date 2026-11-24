import { createApiKey, listApiKeys } from "@webfrost/core";
import { Elysia, t } from "elysia";
import { getDb } from "../context";
import { type DeviceRequest, deviceAuth } from "../device-auth";
import { apiError, apiErrorHandler } from "../errors";
import { MAX_API_KEY_NAME_LENGTH } from "../limits";
import { logger } from "../logger";
import { getClientIp } from "../middleware/rateLimiter";
import { apiKeyOf } from "./auth";
import { serializeApiKey } from "./settings";

/** The page of the web UI where a request is approved; the CLI appends it to the server's URL. */
export const DEVICE_VERIFICATION_PATH = "/#/connect";

/** The name a CLI that gives none is listed under. */
const DEFAULT_DEVICE_NAME = "webfrost CLI";

/** The name as it will be shown and stored: one line of visible text. */
function cleanName(raw: string | undefined): string {
  // Control characters (a newline, an escape sequence) have no place in a name people read.
  const name = (raw ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || DEFAULT_DEVICE_NAME;
}

function serializeRequest(request: DeviceRequest) {
  return {
    userCode: request.userCode,
    name: request.name,
    requesterIp: request.requesterIp,
    status: request.status,
    requestedAt: `${new Date(request.requestedAt).toISOString().slice(0, 19)}Z`,
    expiresAt: `${new Date(request.expiresAt).toISOString().slice(0, 19)}Z`,
  };
}

const userCodeParams = t.Object({ userCode: t.String({ maxLength: 32 }) });

/**
 * Connect a command line to this server (`webfrost login`): the CLI starts a request and polls
 * for its answer without credentials; a signed-in person approves it in the web UI. See
 * device-auth.ts for the protocol.
 */
export const deviceRouter = new Elysia({ prefix: "/auth/device" })
  .onError(apiErrorHandler)
  // Public: the CLI has no credentials yet. It only reserves a slot that someone must approve.
  .post(
    "/",
    ({ body, request, server, set }) => {
      const started = deviceAuth.start({
        name: cleanName(body?.name),
        requesterIp: getClientIp(request, server),
      });
      if (!started) {
        set.headers["retry-after"] = "60";
        return apiError(set, 429, "RATE_LIMITED", "too many connection requests are waiting");
      }
      return {
        ...started,
        verificationPath: DEVICE_VERIFICATION_PATH,
        verificationPathComplete: `${DEVICE_VERIFICATION_PATH}?code=${started.userCode}`,
      };
    },
    {
      body: t.Optional(
        t.Object({ name: t.Optional(t.String({ maxLength: MAX_API_KEY_NAME_LENGTH })) }),
      ),
    },
  )
  // Public: whoever holds the device code (the CLI that started the request) collects the answer.
  .post(
    "/token",
    async ({ body, set }) => {
      const result = deviceAuth.collect(body.deviceCode);
      if (result.status === "unknown") {
        return apiError(set, 404, "NOT_FOUND", "unknown or expired connection request");
      }
      if (result.status !== "approved") return { status: result.status };

      // The key is created now, at the one poll that returns it: it never waits in memory.
      const db = await getDb();
      try {
        const { id, rawKey } = await createApiKey(db, result.name);
        const key = (await listApiKeys(db)).find((k) => k.id === id);
        if (!key) throw new Error("API key not found after insert");
        return { status: "approved" as const, apiKey: rawKey, key: serializeApiKey(key) };
      } finally {
        await db.close();
      }
    },
    { body: t.Object({ deviceCode: t.String({ minLength: 1, maxLength: 128 }) }) },
  )
  .get(
    "/requests/:userCode",
    ({ params, set }) => {
      const request = deviceAuth.find(params.userCode);
      if (!request) return apiError(set, 404, "NOT_FOUND", "unknown or expired code");
      return serializeRequest(request);
    },
    { params: userCodeParams },
  )
  .post(
    "/requests/:userCode/:decision",
    ({ params, request, server, set }) => {
      // Approving creates an API key, so it takes a person signed in to the web UI: a key cannot
      // approve a request and so turn itself into another key.
      if (apiKeyOf(request)) {
        return apiError(set, 403, "FORBIDDEN", "approve connection requests in the web UI");
      }
      const done =
        params.decision === "approve"
          ? deviceAuth.approve(params.userCode)
          : deviceAuth.deny(params.userCode);
      if (!done) {
        return apiError(set, 404, "NOT_FOUND", "unknown, expired or already answered code");
      }
      logger.info(
        { decision: params.decision, by: getClientIp(request, server) },
        "device connection request answered",
      );
      return { ok: true };
    },
    {
      params: t.Object({
        userCode: t.String({ maxLength: 32 }),
        decision: t.Union([t.Literal("approve"), t.Literal("deny")]),
      }),
    },
  );
