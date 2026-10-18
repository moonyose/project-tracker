#!/usr/bin/env python3
"""Fill in the prompt templates for a run and write the subagent definitions.

Usage: render.py <out_dir>   (reads paths from env: QUEUE, TRACKER, WORK, RESULTS, MISSING)
Writes <out_dir>/prompt.md and <out_dir>/agents.json.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def fill(text, vals):
    for k, v in vals.items():
        text = text.replace("{{" + k + "}}", str(v))
    return text


def main(out_dir):
    with open(os.environ["QUEUE"]) as f:
        q = json.load(f)
    vals = {
        "QUEUE": os.environ["QUEUE"],
        "TRACKER": os.environ["TRACKER"],
        "WORK": os.environ["WORK"],
        "RESULTS": os.environ["RESULTS"],
        "MISSING": os.environ.get("MISSING") or "(none)",
        "PARALLEL": q.get("max_parallel_workers", 3),
        "BUDGET": q.get("run_budget_usd", 10),
    }
    with open(os.path.join(ROOT, "agent", "orchestrator.md")) as f:
        prompt = fill(f.read(), vals)
    with open(os.path.join(ROOT, "agent", "worker.md")) as f:
        worker = fill(f.read(), vals)

    model = q.get("model", "claude-opus-5-5")
    agents = {
        "task-worker": {
            "description": "Implements one to-do from Austin's list in its repo, verifies it on the macOS runner, and opens a PR.",
            "prompt": worker,
            "model": model,
            "tools": ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Agent(reviewer)"],
        },
        "reviewer": {
            "description": "Independent reviewer of a worker's diff before the PR is opened. Finds real defects; does not edit.",
            "prompt": (
                "You review a code change made for one to-do item in one of Austin's apps. "
                "You did not write it. Read the task, the diff and the surrounding code in the worktree you are given. "
                "Report only real problems, most severe first: behavior that doesn't match the task, cases the task "
                "names that aren't handled, regressions, crashes, broken tests/laws/specs the repo defines, UI that "
                "contradicts the app's existing patterns. For each: file:line, what goes wrong, and the fix. "
                "If it's sound, say so in one line. Don't nitpick style. Don't edit files."
            ),
            "model": model,
            "tools": ["Bash", "Read", "Glob", "Grep"],
        },
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "prompt.md"), "w") as f:
        f.write(prompt)
    with open(os.path.join(out_dir, "agents.json"), "w") as f:
        json.dump(agents, f)
    print(f"rendered prompt ({len(prompt)} chars) and {len(agents)} agents")


if __name__ == "__main__":
    main(sys.argv[1])
