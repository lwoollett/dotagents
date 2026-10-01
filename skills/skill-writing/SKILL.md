---
name: skill-writing
description: "Use when creating, updating, merging, or deleting agent skills (SKILL.md files under ~/.agents/skills) — authoring structure, trigger descriptions, homologation/merge rules, the deletion bar, and the dotagents git convention. Also when deciding whether something deserves a skill at all vs a memory."
---

# Skill Writing (meta)

Skills are the only cross-session, cross-project knowledge an agent starts with. Write for a future session that has your tools but none of your context.

## 1. Skill vs memory vs nothing
- **Skill** — a repeatable PROCEDURE (ordered steps, commands, parameters, recipes) you will follow again in another session or project. Reuse is the bar; one-off fixes and current-state facts do not qualify.
- **Memory (learn)** — facts, decisions, state ("repo X pushed at commit Y", "doc needs Cmd+S"). No steps to follow.
- **Nothing** — anything re-derivable in seconds (ls, --help, official docs).

## 2. Structure
- One dir per skill: `~/.agents/skills/<kebab-name>/SKILL.md`. Shared by pi AND omp — changes are additive only, never restructure the tree.
- Frontmatter: `name` (kebab, matches dir), `description`, optional `version`. The description is the ONLY thing a future session sees when deciding to load — make it trigger-rich: what it does + when to use + example user phrasings + key exclusions ("never post to Azure", "READ-ONLY").
- Body order: one-line purpose → "Use when" triggers → numbered procedure with exact commands, real paths, real API names → gotchas as numbered traps (symptom → root cause → fix) → cross-references to sibling skills by name.
- Self-contained: resolve relative paths against the skill dir (`dirname SKILL.md`); assume zero session context.

## 3. Homologation — one home per knowledge domain
- Same knowledge in two skills = drift and stale copies. Before creating, check for an existing skill covering the domain; prefer `update` over near-duplicate `create` (manage_skill supports both).
- **Same task, different transport** (MCP vs CLI) → one skill with a fallback section.
- **Project-specific variant of a generic workflow** → a "Project overlay: X" section in the generic skill, not a new skill.
- **Merging procedure:** fold the smaller body in as a section (preserve its gotchas VERBATIM — they are the value), widen the surviving skill's description to cover the folded triggers, delete the empty dir, update the skills README index.
- **Cross-reference instead of duplicating** when domains merely touch (e.g. vision-verify-ui defers CAD capture to fusion360-mcp-cad-builds item 11a).

## 4. Deletion bar
Niche is NOT a reason to delete — a skill encoding non-rederiveable knowledge (masked errors, tenant quirks, hardware bring-up, fixture recipes) earns its keep at any usage frequency. Delete only when fully subsumed by another skill or its subject no longer exists.

## 5. Git convention (dotagents)
`~/.agents` is ONE repo (remote `git@github.com:lwoollett/dotagents.git`). NEVER `git init` inside its subdirectories. After any skill change:
```bash
cd ~/.agents && git add skills/ && git commit -m "feat(skills)|chore(skills): …" && git push
```

## 6. Quality bar (patterns from skills that earned their keep)
- Numbers beat adjectives: "expect 0 warnings", "assert volume 36–44 cm³", not "should be about right".
- Every trap entry = symptom + cause + fix, phrased so the SYMPTOM is greppable when it recurs.
- Parameter tables for recipes; assert discipline for verification steps.
- Capture the same session the lesson lands — deferred capture loses the detail (exact numbers, error strings, order of operations).
