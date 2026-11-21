/**
 * Apply the GitHub repository settings WebFrost relies on. Safe to run again at any time.
 *
 *
 * Needs the GitHub CLI logged in as an admin of the repository. Settings that GitHub offers only to
 * public repositories (private vulnerability reporting, free secret scanning) are reported as skipped
 * while the repository is private; run the script again after making it public.
 */
import { $ } from "bun";

const repo = process.argv[2] ?? "gtkatakura/webfrost";

async function api(method: string, path: string, body?: unknown): Promise<boolean> {
  const input = body === undefined ? "" : JSON.stringify(body);
  const args = [
    "api",
    "-X",
    method,
    `repos/${repo}${path}`,
    "-H",
    "Accept: application/vnd.github+json",
  ];
  if (body !== undefined) args.push("--input", "-");
  const run = await $`gh ${args} < ${new Response(input)}`.nothrow().quiet();
  const ok = run.exitCode === 0;
  const detail = ok ? "" : ` (${run.stderr.toString().trim() || run.stdout.toString().trim()})`;
  console.log(`${ok ? "ok  " : "skip"} ${method} ${path || "/"}${detail}`);
  return ok;
}

// Repository: description, links, merge options.
await api("PATCH", "", {
  description:
    "Self-hosted web archiving: WARC, PDF, screenshots, readable text and video from one visit. CLI, API, SDK and web UI.",
  homepage: "https://webfrost.dev",
  has_issues: true,
  has_discussions: true,
  has_projects: false,
  has_wiki: false,
  allow_squash_merge: true,
  allow_merge_commit: false,
  allow_rebase_merge: true,
  allow_auto_merge: true,
  delete_branch_on_merge: true,
  squash_merge_commit_title: "PR_TITLE",
  squash_merge_commit_message: "PR_BODY",
});
await api("PUT", "/topics", {
  names: [
    "web-archiving",
    "archiving",
    "self-hosted",
    "warc",
    "bookmarks",
    "web-archive",
    "bun",
    "typescript",
    "playwright",
    "sqlite",
  ],
});

// Actions: read-only token by default; the Release workflow opens the "Version Packages" pull request.
await api("PUT", "/actions/permissions/workflow", {
  default_workflow_permissions: "read",
  can_approve_pull_request_reviews: true,
});
// Workflows from forks wait for a maintainer's approval, for every outside contributor.
await api("PUT", "/actions/permissions/fork-pr-contributor-approval", {
  approval_policy: "all_external_contributors",
});

// Security.
await api("PUT", "/vulnerability-alerts");
await api("PUT", "/automated-security-fixes");
await api("PUT", "/private-vulnerability-reporting");
await api("PATCH", "", {
  security_and_analysis: {
    secret_scanning: { status: "enabled" },
    secret_scanning_push_protection: { status: "enabled" },
  },
});

// main: no force-push or deletion, and CI must pass. Admins may bypass, so the maintainer can still push.
const rulesets = JSON.parse(
  (await $`gh api repos/${repo}/rulesets`.nothrow().quiet()).stdout.toString() || "[]",
);
const existing = Array.isArray(rulesets)
  ? rulesets.find((r: { name: string }) => r.name === "main")
  : undefined;
const ruleset = {
  name: "main",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [
          "Lint",
          "Typecheck",
          "Unit Tests",
          "Server API E2E Tests",
          "E2E Tests",
          "Docker build",
        ].map((context) => ({ context })),
      },
    },
  ],
};
await api(existing ? "PUT" : "POST", existing ? `/rulesets/${existing.id}` : "/rulesets", ruleset);
