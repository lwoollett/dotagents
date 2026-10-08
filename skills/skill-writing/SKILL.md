---
name: "skill-writing"
description: "Authoring, homologating, vendoring, and deleting skills in the ~/.agents/skills library — structure, placement, merge rules, third-party vendoring pins, deletion bar, audit checklist"
---

# Skill Writing

Authoring, homologating, and deleting skills in this library (~/.agents/skills, the `dotagents` repo). This is the library's constitution.

## 1. Skill vs memory vs nothing
- **Skill** — a repeatable PROCEDURE (ordered steps, commands, parameters, recipes) you will follow again in another session or project. Reuse is the bar; one-off fixes and current-state facts do not qualify.
- **Memory (learn)** — facts, decisions, state ("repo X pushed at commit Y", "doc needs Cmd+S"). No steps to follow.
- **Nothing** — anything re-derivable in seconds (ls, --help, official docs).

## 2. Structure
- One dir per skill: `~/.agents/skills/<kebab-name>/SKILL.md`. Shared by every pi session and machine — changes are additive only, never restructure the tree.
- Frontmatter: `name` (kebab, matches dir), `description`, optional `version`. The description is the ONLY thing a future session sees when deciding to load — make it trigger-rich: what it does + when to use + example user phrasings + key exclusions ("never post to Azure", "READ-ONLY").
- Body order: one-line purpose → "Use when" triggers → numbered procedure with exact commands, real paths, real API names → gotchas as numbered traps (symptom → root cause → fix) → cross-references to sibling skills by name.
- Bundled extras (scripts/, references/, requirements.txt) live in the skill dir and are referenced by relative path resolved against the dir.

## 3. Placement — global vs repo-local
- **Global (`~/.agents/skills/`)**: workflows valid from any cwd. Test: every relative path in the body resolves against the skill dir (bundled files) or is absolute/portable.
- **Repo-local (`<repo>/.agents/skills/`)**: skills path-coupled to one tree — bodies referencing repo-relative paths (`data/`, manifests, vault layouts) are only correct with cwd inside that repo. Pi discovers project `.agents/skills/` from the cwd's ancestors (stops at repo root), even when the tree is not a git repo. Repo-local skills travel with the clone and stop polluting unrelated sessions' routing.
- **Moving one:** `mv` the dir, note the relocation in the skills README, commit the removal to dotagents. Self-contained but single-project skills may stay global (portable knowledge beats strict clustering).

## 4. Homologation (merging near-duplicates)
- Before creating: grep the library + README for overlapping triggers. Prefer one merged skill with sections over two dirs that both fire on the same phrase.
- Merge = move best body into the surviving dir, delete the other dir, add a README tombstone line ("X merged into Y (date)"), update all cross-references, single commit.
- **Read-first rule**: read BOTH SKILL.md files fully before merging — bodies usually hold incompatible hard-won details that must be interleaved, not concatenated. A merge decided from descriptions alone has already gone wrong.

## 5. Vendoring third-party skills
- **Bar**: only vendor a skill whose tooling runs WITHOUT the parent project's runtime unless that runtime is already in use here. engineering-drawing passes because `uvx --from cadgen==0.7.17 python <drawing>.py` works standalone on any STEP file (the text-to-cad plugin/viewer is NOT needed); a skill hard-wired to a plugin MCP server we don't run is dead weight. Prefer skills that pair with what we already have (Fusion STEP/STL exports, zmk builds).
- **Procedure** (proven on impeccable + three text-to-cad skills, 2026-10-09):
  1. Copy the whole skill dir from the upstream clone — keep `LICENSE`, `scripts/`, `references/`, `requirements.txt` verbatim.
  2. Replace the upstream "Provenance: maintained in …" header with a pinned block: `Vendored from <repo> @ <version> (<short-commit>, <date>) — MIT, see LICENSE. Upstream evolves independently; re-vendor deliberately and diff local changes first.` Plus: the exact runtime command (`uvx --from …` / `python3`, deps via `uvx --with …`), and the smoke-test date + result.
  3. Smoke-test the real tooling once (live API call, real invocation) — never vendor on README trust alone.
  4. README entry in skills/README.md tagged `vendored from <repo> @ <version>` under the right section.
  5. Cross-pointer in the paired skill (e.g. fusion360-mcp-cad-builds item 11 → engineering-drawing).
  6. Single commit: `feat(skills): vendor <name> from <repo> @ <version>`.
- **Never modify vendored code for lint/style** (lens advisories on vendor files are accepted, not fixed); only surgical fixes, recorded in the provenance header. Local mods are why re-vendor = diff first, never blind copy (impeccable precedent: a re-vendor will clobber local bounded-verification changes).
- Current vendored set: impeccable (pbakaus/impeccable v4.3.1), engineering-drawing + step-parts + dfam-check (earthtojake/text-to-cad v0.7.17, 8a352ee).

## 6. Deletion bar
- Delete when: no session has loaded it in ~a month of relevant work AND its triggers are covered elsewhere AND it's not referenced by siblings. Tombstone it in the README ("removed X (date) — superseded by Y") so future-you doesn't re-adopt it.
- Never delete a skill the same turn you doubt it — demote to a README "cold" note first, delete on the next audit.

## 7. Audit checklist (run when the library feels bloated)
1. `ls ~/.agents/skills` — every dir still has a live description in the README index?
2. Any two skills whose descriptions both claim the same trigger phrases? → §4.
3. Any skill not loaded in ~a month of sessions where it should have fired? → tighten the description (it's a routing problem, not a quality problem) or §6.
4. Vendored skills: upstream released since the pin? Note the delta in the README; re-vendor only after diffing local changes (§5).
5. Cross-references resolve (grep sibling names mentioned in bodies).
