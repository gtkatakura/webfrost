---
"@webfrost/cli": minor
"@webfrost/server": minor
"@webfrost/sdk": minor
"@webfrost/ui": minor
---

New `webfrost login <server>`: connect the CLI to a server without creating and copying an API key. The command shows a short code and opens the server's web UI (**Connect a command line**), where you, signed in, approve the request that shows the same code; the server then creates an API key for that machine, listed and revocable under Settings, API keys. The key is saved in `~/.config/webfrost/credentials.json` (readable by you only) and `push` and `rescue` use it for that server; `WEBFROST_API_KEY` still works and takes precedence. `webfrost logout <server>` revokes the key and forgets it.

It follows the OAuth 2.0 Device Authorization Grant (RFC 8628): `POST /auth/device` and `POST /auth/device/token` for the command line (no credentials, rate limited; nothing is created before an approval), `GET /auth/device/requests/:userCode` and `POST /auth/device/requests/:userCode/approve|deny` for the web UI (session only). The SDK gains `startDeviceAuthorization`, `pollDeviceAuthorization`, `getDeviceRequest`, `approveDeviceRequest` and `denyDeviceRequest`.

A server behind a proxy that asks for its own sign-in is reachable too, with nothing tied to one product: `webfrost login --headers-command '<command>'` takes a command that prints the headers the proxy wants (its token tool), saved with the key and run again by `push`, `rescue` and `logout`; `WEBFROST_HEADERS` gives fixed headers (a service token) and `WEBFROST_HEADERS_COMMAND` a command for one run. They are sent only to that server, never printed or saved, and never in place of the API key. A server on a private network (a VPN, a tailnet) needs none of it.
