# Scheduled Claude runs

Every ~4 hours (8am–8pm ET), `.github/workflows/agent.yml` checks this list for
open tasks in projects mapped in `agent/config.json`. If nothing is new, it stops
before calling Claude, so that run costs nothing. If there is work, a macOS runner
clones the app repos. Claude (Opus 5.5) sorts the tasks: code tasks each go to a
worker subagent that makes the change in a git worktree. The worker builds and
tests it with Xcode, gets a second reviewer subagent to check the diff, and opens
a PR. Tasks that need you get a "Needs you" note instead.

Results show on each task in the tracker:
- 🤖 PR ready
- 🙋 Needs you
- ⛔ Blocked
- ⚠️ Couldn't finish

To have Claude look at a task again, edit its text or notes in data.json (for example, from a Claude chat).
Edits made in the browser are committed to data.json once it is connected to GitHub (see ../README.md).

## Controls
- **Budget**: `agent/config.json` → `budget.total_usd` (lifetime cap), `per_run_usd`
  (hard cap per run, enforced by `--max-budget-usd`), `stop_after` (date).
  Spend so far: `agent/ledger.json`.
- **Which projects**: `agent/config.json` → `projects.<project id>.enabled`.
- **Permissions**: `agent/permissions.json`. Every command not on the allow-list is
  denied. Claude can't merge, push to main/master, force-push, or call the GitHub API.
- **Run now**: Actions tab → "Claude works the to-do list" → Run workflow.
- **Turn off**: Actions tab → the workflow → ⋯ → Disable workflow.

## Secrets (Settings → Secrets and variables → Actions)
- `ANTHROPIC_API_KEY`: a Claude Console API key, billed to your API credits.
- `AGENT_GH_TOKEN`: a fine-grained GitHub token with access to this repo and the app
  repos, with permissions Contents: read/write and Pull requests: read/write.
