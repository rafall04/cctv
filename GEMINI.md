# GEMINI COMPATIBILITY RULES

This file is a compatibility shim. Canonical project policy is in `AGENTS.md`.

## Precedence
1. `AGENTS.md` (authoritative)
2. `GEMINI.md` (this file)

If any instruction here conflicts with `AGENTS.md`, `AGENTS.md` wins.

## Required Workflow
- Read active `.sisyphus/plans/*.md` before making code changes.
- Do not perform blind edits without a plan for non-trivial tasks.
- Use ESM only (`import/export`), never mix with CommonJS.
- Use async I/O, never synchronous FS/process calls in hot paths.
- For recording file deletion, respect `LockManager` concurrency safety.

## Git Rule (Mandatory)
- Every completed and verified change must be committed and pushed to GitHub immediately, unless the task is explicitly marked local-only.
