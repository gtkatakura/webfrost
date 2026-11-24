---
"@webfrost/cli": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": minor
---

New `webfrost login <server>`: connect the CLI to a server without creating and copying an API key. The command shows a short code and opens the server's web UI (**Connect a command line**), where you, signed in, approve the request that shows the same code; the server then creates an API key for that machine, listed and revocable under Settings, API keys. The key is saved in `~/.config/webfrost/credentials.json` (readable by you only) and `push` and `rescue` use it for that server; `WEBFROST_API_KEY` still works and takes precedence. `webfrost logout <server>` revokes the key and forgets it.

It follows the OAuth 2.0 Device Authorization Grant (RFC 8628): `POST /auth/device` and `POST /auth/device/token` for the command line (no credentials, rate limited; nothing is created before an approval), `GET /auth/device/requests/:userCode` and `POST /auth/device/requests/:userCode/approve|deny` for the web UI (session only). The SDK gains `startDeviceAuthorization`, `pollDeviceAuthorization`, `getDeviceRequest`, `approveDeviceRequest` and `denyDeviceRequest`.
