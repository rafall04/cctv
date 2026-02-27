# Rules Conflict Matrix

This matrix tracks scope boundaries and conflict resolution across project rule documents.

## Authority Order
1. `AGENTS.md` (canonical)
2. `.cursorrules` and `GEMINI.md` (compatibility mirrors)
3. `SECURITY.md` and `README.md` (operational guidance)

## Matrix

| Topic | AGENTS.md | .cursorrules | GEMINI.md | SECURITY.md | README.md | Resolution |
|---|---|---|---|---|---|---|
| Workflow gate | Required (`.sisyphus/plans`) | Required | Required | N/A | N/A | Follow `AGENTS.md` |
| Module system | ESM-only | ESM-only | ESM-only | N/A | N/A | Follow `AGENTS.md` |
| Async I/O policy | Async-only for hot paths | Async-only | Async-only | N/A | N/A | Follow `AGENTS.md` |
| Concurrency safety | LockManager required | Lock required | Lock required | N/A | N/A | Follow `AGENTS.md` |
| Verification gate | Required before completion | Required | Required | N/A | N/A | Follow `AGENTS.md` |
| Git push policy | Required after verification | Required | Required | N/A | N/A | Follow `AGENTS.md` |
| Security hardening details | Referenced | Referenced | Referenced | Defined | Referenced | `SECURITY.md` defines details; `AGENTS.md` governs workflow |
| Deployment examples | Referenced | N/A | N/A | Example snippets | Example snippets | If examples conflict with policy, follow `AGENTS.md` |

## Maintenance Rule
- Any update to `AGENTS.md`, `.cursorrules`, `GEMINI.md`, `SECURITY.md`, or `README.md` must update this matrix if scope or authority changes.
