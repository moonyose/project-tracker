#!/usr/bin/env python3
"""Pick the to-dos a scheduled Claude run should look at. Spends nothing.

A task is eligible when it is not done, its project is mapped and enabled in
agent/config.json, and Claude hasn't already handled this exact wording of it
(task.agent.hash matches the current text+notes). Editing a task's text or
notes after Claude has looked at it makes it eligible again.

Writes the queue to $QUEUE (default agent/queue.json) and, when running in
GitHub Actions, sets outputs: has_work, repos, budget_left, reason.
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# Tasks that are Austin testing something himself ("Test new version myself",
# "Playtest more", ...) are his to do, not Claude's. Skip them without spending anything.
SELF_TEST = re.compile(r"\bmyself\b|^\s*(play[- ]?test|test|try|play with)\b", re.I)


# The bot only does coding work (app and Roblox game improvements). Social media,
# ads, marketing, outreach and account/admin tasks are skipped outright.
NOT_CODE = re.compile(
    r"^\s*(post|make (\w+ )?(video )?ads?|run ads|restart (the )?ad|message|email|text|call|reply|dm|"
    r"follow up|reach out|set up .*\baccount|pay|fund|move money|close .*\baccount|tell |ask |"
    r"schedule|book |recruit|read )\b"
    r"|instagram post|social media|ad campaign|marketing|influencer|outreach",
    re.I,
)


def is_not_code(t):
    return bool(NOT_CODE.search(t.get("text") or ""))


def is_self_test(t):
    return bool(SELF_TEST.search(t.get("text") or ""))


def task_hash(t):
    s = (t.get("text") or "").strip() + "\n" + (t.get("notes") or "").strip()
    return hashlib.sha1(s.encode()).hexdigest()[:12]


def load(name, default=None):
    p = os.path.join(ROOT, name)
    if not os.path.exists(p):
        return default
    with open(p) as f:
        return json.load(f)


def main():
    cfg = load("agent/config.json")
    data = load("data.json")
    ledger = load("agent/ledger.json", {"spent_usd": 0, "runs": []})
    now = dt.datetime.now(dt.timezone.utc)

    budget = cfg["budget"]
    left = round(budget["total_usd"] - ledger.get("spent_usd", 0), 2)
    reason = ""
    queue = []

    if now.date() > dt.date.fromisoformat(budget["stop_after"]):
        reason = f"past stop date {budget['stop_after']}"
    elif left < 2:
        reason = f"budget used up (${ledger.get('spent_usd', 0):.2f} of ${budget['total_usd']})"
    else:
        for c in data["categories"]:
            for p in c["projects"]:
                pc = cfg["projects"].get(p["id"])
                if not pc or not pc.get("enabled") or not pc.get("repos"):
                    continue
                for t in p["tasks"]:
                    if t.get("done") or is_self_test(t) or is_not_code(t):
                        continue
                    h = task_hash(t)
                    a = t.get("agent") or {}
                    if a.get("hash") == h and a.get("status") != "retry":
                        continue
                    queue.append({
                        "task_id": t["id"],
                        "project_id": p["id"],
                        "project": p["name"],
                        "project_status": p.get("status", ""),
                        "text": t.get("text", ""),
                        "notes": t.get("notes", ""),
                        "due": t.get("due"),
                        "hash": h,
                        "previous_attempt": a or None,
                        "repos": pc["repos"],
                        "platform": pc.get("platform"),
                        "verify": pc.get("verify", []),
                        "project_notes": pc.get("notes", ""),
                        "priority": pc.get("priority", 9),
                    })
        queue.sort(key=lambda q: q["priority"])
        queue = queue[: cfg.get("max_tasks_per_run", 6)]
        if not queue:
            reason = "nothing new on the list"

    per_run = min(budget["per_run_usd"], left)
    out = {
        "generated_at": now.isoformat(timespec="seconds"),
        "model": cfg["model"],
        "max_parallel_workers": cfg.get("max_parallel_workers", 3),
        "run_budget_usd": per_run,
        "tasks": queue,
    }
    qpath = os.environ.get("QUEUE", os.path.join(ROOT, "agent", "queue.json"))
    with open(qpath, "w") as f:
        json.dump(out, f, indent=2)

    repos = sorted({r for q in queue for r in q["repos"]})
    print(f"{len(queue)} task(s) queued; budget left ${left:.2f}; run cap ${per_run:.2f}"
          + (f"; skipping: {reason}" if reason else ""))
    for q in queue:
        print(f"  - [{q['project']}] {q['text'][:90]}")

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as f:
            f.write(f"has_work={'true' if queue else 'false'}\n")
            f.write(f"repos={' '.join(repos)}\n")
            f.write(f"budget_left={left}\n")
            f.write(f"run_budget={per_run}\n")
            f.write(f"model={cfg['model']}\n")
            f.write(f"reason={reason}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
