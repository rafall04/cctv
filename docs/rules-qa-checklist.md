# Rules QA Checklist

Use this checklist before merging any rule-document update.

## Scope
- [ ] Change scope is clear (workflow, security, deployment, compatibility).
- [ ] Canonical policy remains in `AGENTS.md`.

## Consistency
- [ ] `AGENTS.md` and `.cursorrules` do not conflict.
- [ ] `AGENTS.md` and `GEMINI.md` do not conflict.
- [ ] `README.md` and `SECURITY.md` examples do not contradict policy authority.
- [ ] `docs/rules-conflict-matrix.md` updated if authority/scope changed.

## Safety and Quality Gates
- [ ] Planning gate policy still present for non-trivial work.
- [ ] Verification gate policy still present (syntax/tests/build as applicable).
- [ ] Git gate policy still present (verify -> commit -> push).
- [ ] ESM-only and async-I/O constraints preserved.
- [ ] Recording concurrency lock safety rule preserved.

## Operational Clarity
- [ ] Environment/path guidance avoids host-specific hardcoded assumptions.
- [ ] Any required env vars are documented in relevant docs.
- [ ] New examples are marked as examples, not policy overrides.

## Final Review
- [ ] Rule docs reviewed together: `AGENTS.md`, `.cursorrules`, `GEMINI.md`, `README.md`, `SECURITY.md`.
- [ ] No unresolved conflicts remain.
