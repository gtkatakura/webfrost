# WebFrost

## Git Workflow

**After completing any task that modifies code, you MUST commit and push to remote.**

1. Stage only the files you changed (no `git add -A` or `git add .`).
2. Write a clear, concise commit message describing the change.
4. Push to the remote: `git push origin HEAD`.
5. If the push fails due to upstream changes, pull with rebase (`git pull --rebase origin main`) and push again.
6. Never force-push to `main`.

## Pre-commit Hooks

Lefthook runs lint (biome) and typecheck on pre-commit. Fix any failures before committing — do not skip hooks with `--no-verify`.

## Monorepo

- Package manager: **bun**
- Workspaces: `packages/*`
- Lint: `bun run lint`
- Format: `bun run format`
- Test: `bun run test`
- Typecheck: `bun run typecheck`

## Agent Handoff Protocol

**When you finish a task, hand it off immediately — don't leave it for the next heartbeat.**

### How to hand off

When your work is done and the next step belongs to another agent:

1. PATCH the issue: set `assigneeAgentId` to the next agent's ID, set `status` to `todo`.
2. Add a comment explaining what you did and what the next agent needs to do.
3. The reassignment triggers an immediate wake — no heartbeat delay.

### When NOT to hand off

- The task description says "needs human review" or "board approval".
- You're blocked on external input (mark `blocked` instead).
- The task is fully done with no downstream work needed (mark `done`).
- You're unsure who should pick it up (mark `done` and comment; let the CEO or PO route it).

### Routing Table

| You are | Your work | Hand off to |
|---------|-----------|-------------|
| Product Owner | Spec / acceptance criteria written | **Engineer** (to implement) |
| Product Owner | QA-related task scoped | **QA Engineer** (to execute) |
| Product Owner | Docs task scoped | **Technical Writer** (to write) |
| Product Owner | Infra task scoped | **DevOps** (to implement) |
| Engineer | Feature / fix implemented and pushed | **QA Engineer** (to verify) |
| Engineer | Infra-related change pushed | **DevOps** (to review/deploy) |
| QA Engineer | Tests pass, feature verified | Mark **done** |
| QA Engineer | Bug found during verification | **Engineer** (to fix, with repro details) |
| DevOps | CI/CD or infra change deployed | Mark **done** |
| DevOps | Needs docs update | **Technical Writer** |
| Technical Writer | Docs written and pushed | Mark **done** |

### Agent IDs (for `assigneeAgentId`)

| Agent | ID |
|-------|-----|

### Handoff comment format

```markdown
## Handoff → [Next Agent Name]

**Done:** [1-2 sentences on what you completed]
**Next:** [What the receiving agent should do]
**Context:** [Any relevant details — PR link, test results, blockers cleared]
```
