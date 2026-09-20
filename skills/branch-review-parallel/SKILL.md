---
name: branch-review-parallel
description: Review a local git branch/diff against main (incl. uncommitted working-tree branches) and fix findings via parallel reviewer/fixer agents
---

# Branch Review + Verified Fix Fan-Out

Use when asked to review a git branch/diff against main (or to fix review findings), especially in repos where branch work may be uncommitted.

## 1. Scope the change
- `git branch --show-current`, `git log --oneline main..HEAD`, `git diff --stat` — if log/diff are empty but `git status -sb` shows modifications + untracked files, the branch is at main's HEAD with **uncommitted working-tree changes**: review `git diff` (tracked) + untracked files.
- Read the FULL diff yourself plus every new file and the surrounding context in touched production files (event emission points, callers, DI registration). Grounding yourself lets you validate subagent claims later.

## 2. Fan out parallel reviewer subagents (one `tasks[]` batch)
Slice by concern with DISJOINT file sets, e.g.: (a) core mechanism correctness, (b) new components/models/contracts, (c) test quality (would each test fail pre-fix? coverage lost/gained? tautologies?). Give each agent: branch state (uncommitted vs committed), what the change does, repo conventions/anti-patterns to NOT flag, and the rule: **verify every claim against actual code/files — no speculation; report severity + file:line + code evidence**. Tell reviewers NOT to build/test — parent runs those.

## 3. Verify before reporting
- Run build + test suite yourself in parallel with reviewers.
- Ground each reviewer's highest-impact claim with a cheap direct measurement (e.g. `grep -roiE '(^|[^a-z0-9_])term' corpus | wc -l` vs substring count) — catches wrong measurements and overclaims.
- Deliver review with: explicitly verified-correct list, should-fix, minor, nits, adjacent/pre-existing (labeled as such).

## 4. Fix fan-out (when asked to fix)
- Investigate ambiguity FIRST yourself (e.g. git history `git log -S`, `git show <commit>` to settle comment-vs-code contradictions) so fix specs are exact.
- Compute any data-dependent test expectations yourself BEFORE spawning (grep counts, expected rankings) and embed the numbers in the task specs — determinism by construction.
- Spawn parallel fix agents with disjoint file ownership (one writer per file), a shared behavior-contract section when prod + test agents depend on each other, and the constraint: no builds/tests/formats — parent integrates and verifies.
- After all land: build, full suite, and SPOT-READ every critical edited region (never trust agent "done" claims); verify new-test count matches expectations.
