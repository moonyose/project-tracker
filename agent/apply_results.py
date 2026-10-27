#!/usr/bin/env python3
"""Write a run's outcomes back into data.json and the spend ledger.

Usage: apply_results.py <queue.json> <results_dir> [claude_output.json]

Each worker leaves <results_dir>/<task_id>.json:
  {"task_id", "status": "pr_opened|needs_austin|blocked|failed",
   "summary", "pr_url"?, "verified"?, "next_step"?}

Run this against a fresh checkout of main so it never clobbers edits Austin
made while the run was going: it only sets each task's `agent` field and
updates agent/ledger.json.
"""
import datetime as dt
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUSES = {"pr_opened", "needs_austin", "blocked", "failed", "done_no_change", "skipped_not_code"}


def main(queue_path, results_dir, claude_out=None):
    with open(queue_path) as f:
        queue = json.load(f)
    results = {}
    for p in glob.glob(os.path.join(results_dir, "*.json")):
        try:
            with open(p) as f:
                r = json.load(f)
            if r.get("task_id"):
                results[r["task_id"]] = r
        except Exception as e:  # a malformed result shouldn't sink the run
            print(f"skip {p}: {e}")

    cost, turns, session = 0.0, None, None
    if claude_out and os.path.exists(claude_out):
        try:
            with open(claude_out) as f:
                txt = f.read().strip()
            # --output-format json prints one object; stream-json prints many lines
            try:
                obj = json.loads(txt)
            except ValueError:
                obj = json.loads(txt.splitlines()[-1])
            if isinstance(obj, list):  # some versions print the message array
                obj = next((m for m in reversed(obj) if m.get("type") == "result"), {})
            cost = float(obj.get("total_cost_usd") or obj.get("cost_usd") or 0)
            turns = obj.get("num_turns")
            session = obj.get("session_id")
        except Exception as e:
            print(f"could not read cost from {claude_out}: {e}")

    data_path = os.path.join(ROOT, "data.json")
    with open(data_path) as f:
        data = json.load(f)
    by_id = {t["id"]: t for c in data["categories"] for p in c["projects"] for t in p["tasks"]}

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    lines = []
    for q in queue["tasks"]:
        t = by_id.get(q["task_id"])
        if t is None:
            continue  # Austin deleted it mid-run
        prev = t.get("agent") or {}
        r = results.get(q["task_id"])
        if r and r.get("status") in STATUSES:
            a = {
                "status": r["status"],
                "summary": (r.get("summary") or "")[:600],
                "hash": q["hash"],
                "at": now,
            }
            for k in ("pr_url", "verified", "next_step"):
                if r.get(k):
                    a[k] = str(r[k])[:400]
        else:
            attempts = int(prev.get("attempts", 0)) + 1
            a = {
                "status": "retry" if attempts < 2 else "failed",
                "summary": "The run ended before this task finished (time or budget cap)."
                + (" Will try once more next run." if attempts < 2 else " Edit the task to try again."),
                "hash": q["hash"],
                "attempts": attempts,
                "at": now,
            }
        t["agent"] = a
        lines.append(f"{a['status']}: {q['text'][:60]}")

    data["updated"] = dt.date.today().isoformat()
    with open(data_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    lp = os.path.join(ROOT, "agent", "ledger.json")
    ledger = {"spent_usd": 0, "runs": []}
    if os.path.exists(lp):
        with open(lp) as f:
            ledger = json.load(f)
    # API runs spend the prepaid credit; subscription runs don't, so their (notional) cost is kept apart.
    auth_used = os.environ.get("AUTH_USED", "api")
    if auth_used == "subscription":
        ledger["subscription_notional_usd"] = round(ledger.get("subscription_notional_usd", 0) + cost, 4)
    else:
        ledger["spent_usd"] = round(ledger.get("spent_usd", 0) + cost, 4)
    if os.environ.get("API_EXHAUSTED") == "1" and not ledger.get("api_exhausted"):
        ledger["api_exhausted"] = True
        ledger["api_exhausted_at"] = now
    ledger["runs"].append({
        "at": now, "cost_usd": round(cost, 4), "auth": auth_used, "turns": turns, "session": session,
        "tasks": len(queue["tasks"]), "run_id": os.environ.get("GITHUB_RUN_ID"),
    })
    ledger["runs"] = ledger["runs"][-200:]
    with open(lp, "w") as f:
        json.dump(ledger, f, indent=1)
        f.write("\n")

    print(f"run cost ${cost:.2f}; total ${ledger['spent_usd']:.2f}")
    for l in lines:
        print("  " + l)
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as f:
            f.write(f"cost={cost:.2f}\ntotal={ledger['spent_usd']:.2f}\n")


if __name__ == "__main__":
    main(*sys.argv[1:4])
