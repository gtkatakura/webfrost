---
name: debug-gha
description: >
  Debug GitHub Actions failures locally using `act`. Simulates workflows,
  identifies the failing step, and verifies fixes before pushing.
license: MIT
user-invocable: true
metadata:
  # For contributors to this repository, not for people installing WebFrost skills.
  internal: true
  author: webfrost
  version: "0.1.0"
  argument-hint: "[workflow] [job] [--event push|pull_request]"
---

# Debug GitHub Actions Locally

Use `act` to reproduce and fix GitHub Actions failures without push-and-pray cycles.

## Usage

```
/debug-gha [workflow] [job] [--event push|pull_request]
```

- Default (no args): runs the CI workflow (`ci.yml`) with `push` event.
- `workflow`: workflow file name without path (e.g., `ci`, `release`, `bench-vs-archivebox`).
- `job`: specific job name to run (e.g., `ci`, `docker`, `bench`).
- `--event`: event type to simulate (default: `push`).

## Prerequisites

- **`act`** must be installed: `brew install act` (macOS) or see https://github.com/nektos/act
- **Docker** must be running.

Verify before proceeding:

```bash
command -v act >/dev/null 2>&1 || { echo "act is not installed. Install with: brew install act"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker first."; exit 1; }
```

## Procedure

Follow these steps in order. Do NOT skip steps.

### Step 1 — Parse arguments

| Argument | Default | Notes |
|----------|---------|-------|
| `workflow` | `ci` | Maps to `.github/workflows/{workflow}.yml` |
| `job` | (all jobs) | Pass with `-j {job}` flag to `act` |
| `--event` | `push` | First positional arg to `act` |

### Step 2 — Verify prerequisites

Run these checks. If either fails, stop and tell the user what to install/start:

```bash
command -v act >/dev/null 2>&1 || echo "MISSING: act"
docker info >/dev/null 2>&1 || echo "MISSING: docker"
```

### Step 3 — Read the workflow file

Read `.github/workflows/{workflow}.yml` to understand:
- What jobs exist and their dependencies (`needs`)
- What steps each job runs
- What services or containers are required
- What secrets or env vars are expected

### Step 4 — Dry run first

Run `act` in dry-run mode to validate the workflow parses correctly:

```bash
act {event} -W .github/workflows/{workflow}.yml -n
```

If this fails, the workflow file has syntax issues. Fix those first.

### Step 5 — Run the workflow locally

Build and run the command:

```bash
act {event} -W .github/workflows/{workflow}.yml [-j {job}] --container-architecture linux/amd64 2>&1
```

Key flags:
- `--container-architecture linux/amd64`: required on Apple Silicon (matches GitHub runners).
- `-j {job}`: only if a specific job was requested.
- `--env-file .env.act`: if an `.env.act` file exists in the project root, use it for secrets/env.
- `-s GITHUB_TOKEN="$(gh auth token)"`: pass GitHub token if the workflow needs it.

### Step 6 — Analyze the failure

When the run fails:

1. **Identify the failing step** — `act` logs show `[job/step]` prefixes. Find the first red/error output.
2. **Read the error message** — copy the exact error text.
3. **Map to source** — determine which file, config, or dependency caused the failure.
4. **Check common `act` limitations**:
   - `act` does not support `actions/cache` natively (usually safe to ignore cache misses).
   - Service containers may need `--container-daemon-socket` configuration.
   - Some GitHub-specific contexts (`github.event.pull_request`, etc.) may be empty unless you provide an event payload via `--eventpath`.
   - `oven-sh/setup-bun` and other setup actions may behave differently locally.

### Step 7 — Fix and re-run

1. Make the fix in the source code or workflow file.
2. Re-run the exact same `act` command from Step 5.
3. Repeat until the workflow passes locally.

### Step 8 — Confirm the fix

Once the local run passes:

1. Run the project's own checks to make sure nothing else broke:
   ```bash
   bun run lint && bun run typecheck && bun run test
   ```
2. Summarize what failed, why, and what you changed.

## Limitations and Workarounds

| Limitation | Workaround |
|-----------|------------|
| `actions/cache` not supported | Ignore cache miss warnings; deps install fresh each run |
| No GitHub context for PRs | Create a JSON event file: `act pull_request --eventpath pr-event.json` |
| Docker-in-Docker needed | Ensure Docker socket is mounted (default in `act`) |
| Secrets not available | Use `--secret-file .secrets` or `-s KEY=value` |
| `setup-bun` may fail | If so, skip with `--replace "oven-sh/setup-bun@v2="` and ensure bun is in the container |

## Output

When done, report:
- Which workflow and job were tested
- The failing step (if any) and root cause
- What was fixed
- Confirmation that the local run now passes
