# Project Tracker

Personal project tracker. Live: https://moonyose.github.io/project-tracker/

**`data.json` in this repo is the single source of truth.** Every change made in the web UI (check/uncheck, sub-item
checks, add, edit, notes, attachments, archive, delete, project rename/status) is committed straight to `data.json`
through the GitHub contents API, once the browser is connected (🔗 Connect GitHub → paste a fine-grained token with
access to only this repo and **Contents: Read and write**; it is stored only in that browser's localStorage).

- Sync status in the toolbar: ✅ Saved · ⏳ Saving… · ⚠ Not connected — changes are local only · 📴 Offline · ❌ Error.
  Unsaved changes are queued in localStorage (`pt-pending-v2`) and retried; a conflicting commit makes the UI re-fetch,
  re-apply the change on top and retry.
- Merge is per task: each change stamps the task's `updatedAt`; a queued browser change only applies if it is newer
  than the task's `updatedAt` on the server. There is no more `rev`/`doneRev` "server wins" logic (old fields are ignored).
- The page reads `data.json` fresh through the API (not the Pages copy, which lags about a minute after a commit).
- **Archive**: checking a task (or 🗑) marks it done with `completedAt`; it moves to the 🗄 Archive tab. ↩ un-archives.
  🗑 inside the Archive deletes it from `data.json`. When every task on a card is done, the card leaves Active and
  shows in the Archive with 🗂 View archived card.
- **Attachments**: `"attachments": [{"name": "...", "url": "attachments/file.pdf"}]`. Files picked in the browser
  (≤1.5 MB) are uploaded to `attachments/` when connected.
- **Sub-items**: `"subtasks": [{"id","text","done","completedAt","updatedAt"}]` are checkable under their task.
- Upgrading from the old localStorage-only version: on first load, checkoffs and new tasks that existed only in that
  browser are pushed to `data.json` (old copy kept under `pt-state-v1-backup`).

## For AI agents

- Read `data.json` from `main` (fresh: `gh api repos/moonyose/project-tracker/contents/data.json -H "Accept: application/vnd.github.raw+json"`
  or `git pull`). Don't rely on the Pages URL; it can be a minute stale.
- Structure: `categories[] → projects[] (a card) → tasks[]`. Open work = tasks with `done` false/missing (archived
  tasks are simply `done: true`). Projects in `agent/config.json` with `enabled: false` and `skip_task_ids` are off-limits
  for the scheduled agent.
- **Austin-only (agent hold):** a task with `"owner": "austin"` is human-only; Austin handles it himself. AI agents
  (Claude Code, the scheduled agent, any other bot) must **skip it**: don't work on it, don't open PRs for it, don't
  mark it done or edit it. The same applies to **every task on a card** whose project has `"owner": "austin"`. The
  UI shows these with a 👤 Austin only badge. Only Austin removes the field.
- `text` is the task; `notes` is context/status; `transcript` (optional) is Austin's full verbatim request — read it
  for detail. `subtasks[]` are steps; open ones have `done` false. `agent` is written by `agent/apply_results.py`.
- To mark a task (or sub-task) done: set `"done": true`, `"completedAt"` and **`"updatedAt"` to the current ISO
  time** (e.g. `2026-10-19T14:05:00Z`), then commit and push `data.json` to `main`. Always set `updatedAt` on any task
  you edit (text, notes, done), otherwise an older queued change from Austin's browser may override it. Pull/rebase
  right before pushing and keep the file format (`json.dump(data, f, indent=2)` + trailing newline).
- Never reopen a task Austin checked off unless he asks; never remove tasks to "clean up".
