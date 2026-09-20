---
name: privateai-api-branch-review
description: "Use when reviewing a branch/working tree against main in PrivateAI.API — adversarial, evidence-grounded code review"
---

# Branch Review — PrivateAI.API

1. **Establish change scope.** Branch may have zero commits — all changes uncommitted in working tree. Run `git status -sb`, `git diff` (tracked), and read every untracked file. Do not rely on `git log main..HEAD`.
2. **Read everything yourself first.** Full diff + all new files + surrounding context of each touched symbol (e.g. the full loop a hunk sits in). Grounding needed to validate subagent claims later.
3. **Fan out 3 parallel reviewer subagents** (one `tasks[]` batch):
   - core-flow correctness (services/functions touched)
   - new-component correctness (plugins/models/corpus — verify against actual data files)
   - tests quality (would each new test fail pre-fix? deleted coverage? gaps?)

   Give each: the diff summary, repo conventions, severity format, and explicit READ-ONLY (no builds/tests — parent runs those).
4. **Verify high-impact claims yourself** — grep/count against real corpus files, read cited lines, confirm pre-fix failure by reasoning over the diff hunks.
5. **Run**: `dotnet build AskJ.Api.sln` (expect 0 warnings) and `dotnet test tests/AskJ.Api.Tests --filter "Category!=Integration"` (CI-equivalent; Integration tests need local Postgres :5566).
6. **Report**: verdict first; findings ordered blocker→major→minor→nit with file:line + evidence; separate adjacent/pre-existing from in-scope; list explicitly verified-correct items so cleared concerns aren't re-litigated.

Rules: never flag AGENTS.md intentional anti-patterns (no rate limiting, no request-validation middleware). Be adversarial about correctness (ordering, nullability, lifetimes, DI), then contracts, then nits.
