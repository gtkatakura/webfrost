import pino from "pino";

// WEBFROST_LOG_LEVEL is the documented name (shared with the CLI); LOG_LEVEL is kept
// as a fallback for existing deployments.
export const logger = pino({
  level: process.env.WEBFROST_LOG_LEVEL ?? process.env.LOG_LEVEL ?? "info",
});
