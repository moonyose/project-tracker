# Project Tracker

Personal project tracker. Live: https://moonyose.github.io/project-tracker/

Data lives in `data.json`; in-browser edits are stored in localStorage (`pt-state-v1`) and layered on top.
Nothing edited in the browser is committed back. Use Export to save a copy.

- **Archive**: checking a task (or clicking 🗑) moves it to the 🗄 Archive tab with a `completedAt` date. ↩ un-archives it. 🗑 inside the Archive deletes it permanently.
- Tasks deleted with the old hard-delete are brought back into the Archive automatically from `data.json`, flagged ♻ recovered, and ⚠ was open if they weren't done.
- **Attachments**: `"attachments": [{"name": "...", "url": "attachments/file.pdf"}]` on a task. Put the files in `attachments/`. The 📎 button adds a link, or a small file (≤1.5 MB) stored only in that browser.
