---
name: "skill-writing"
description: "Use when creating, updating, placing, merging, or deleting agent skills (SKILL.md files under ~/.agents/skills or repo-local .agents/skills) — authoring structure, trigger descriptions, global-vs-repo-local placement, homologation/merge rules, the deletion bar, the dotagents git convention, vendoring third-party skill/tool repos from GitHub (triage, security scan, routing-weight test, vault+router pattern, MCP registration), and the library audit checklist. Also when deciding whether something deserves a skill at all vs a memory."
---

# Skill Writing (meta)

Skills are the only cross-session, cross-project knowledge an agent starts with. Write for a future session that has your tools but none of your context.

## 1. Skill vs memory vs nothing
- **Skill** — a repeatable PROCEDURE (ordered steps, commands, parameters, recipes) you will follow again in another session or project. Reuse is the bar; one-off fixes and current-state facts do not qualify.
- **Memory (learn)** — facts, decisions, state ("repo X pushed at commit Y", "doc needs Cmd+S"). No steps to follow.
- **Nothing** — anything re-derivable in seconds (ls, --help, official docs).

## 2. Structure
- One dir per skill: `~/.agents/skills/<kebab-name>/SKILL.md`. Shared by every pi session and machine — changes are additive only, never restructure the tree.
- Frontmatter: `name` (kebab, matches dir), `description`, optional `version`. The description is the ONLY thing a future session sees when deciding to load — make it trigger-rich: what it does + when to use + example user phrasings + key exclusions ("never post to Azure", "READ-ONLY").
- Body order: one-line purpose → "Use when" triggers → numbered procedure with exact commands, real paths, real API names → gotchas as numbered traps (symptom → root cause → fix) → cross-references to sibling skills by name.
- Self-contained: resolve relative paths against the skill dir (`dirname SKILL.md`); assume zero session context.

## 3. Placement — global vs repo-local
- **Global (`~/.agents/skills/`)**: workflows valid from any cwd. Test: every relative path in the body resolves against the skill dir (bundled files) or is absolute/portable.
- **Repo-local (`<repo>/.agents/skills/`)**: skills path-coupled to one tree — bodies referencing repo-relative paths (`data/`, manifests, vault layouts) are only correct with cwd inside that repo. Pi discovers project `.agents/skills/` from the cwd's ancestors (stops at repo root), even when the tree is not a git repo. Repo-local skills travel with the clone and stop polluting unrelated sessions' routing.
- **Moving one:** `mv` the dir, note the relocation in the skills README, commit the removal to dotagents. Self-contained but single-project skills may stay global (portable knowledge beats strict clustering).

## 4. Homologation — one home per knowledge domain
- Same knowledge in two skills = drift and stale copies. Before creating, check for an existing skill covering the domain; prefer `update` over near-duplicate `create` (manage_skill supports both).
- **Same task, different transport** (MCP vs CLI) → one skill with a fallback section.
- **Project-specific variant of a generic workflow** → a "Project overlay: X" section in the generic skill, not a new skill.
- **Merging procedure:** fold the smaller body in as a section (preserve its gotchas VERBATIM — they are the value), widen the surviving skill's description to cover the folded triggers, delete the empty dir, update the skills README index.
- **Read both FULL bodies BEFORE creating anything.** Compose the final merged body first, then write it ONCE (file write or a single manage_skill call) — never mint placeholder/draft skills mid-consolidation: manage_skill creates live library entries instantly, and an interrupted placeholder loop leaves junk dirs in the tree (2026-10-06 hit: a ten-call create/delete placeholder loop fired during the godot consolidation before any source read). Sequence: read sources → compose → single final write → rm old dirs → README → commit.
- **Cross-reference instead of duplicating** when domains merely touch (e.g. vision-verify defers CAD capture to fusion360-mcp-cad-builds item 11a).

## 5. Deletion bar
Niche is NOT a reason to delete — a skill encoding non-derivable knowledge (masked errors, tenant quirks, hardware bring-up, fixture recipes) earns its keep at any usage frequency. Delete only when fully subsumed by another skill or its subject no longer exists.

## 6. Git convention (dotagents)
`~/.agents` is ONE repo (remote `git@github.com:lwoollett/dotagents.git`). NEVER `git init` inside its subdirectories. After any skill change:
```bash
cd ~/.agents && git add skills/ && git commit -m "feat(skills)|chore(skills): …" && git push
```

## 7. Quality bar (patterns from skills that earned their keep)
- Numbers beat adjectives: "expect 0 warnings", "assert volume 36–44 cm³", not "should be about right".
- Every trap entry = symptom + cause + fix, phrased so the SYMPTOM is greppable when it recurs.
- Parameter tables for recipes; assert discipline for verification steps.
- Capture the same session the lesson lands — deferred capture loses the detail (exact numbers, error strings, order of operations).

## 8. Vendoring third-party skills and tools (from GitHub etc.)
The procedure for "install this skill/tool repo" requests (first run 2026-10-10, commits 10e9023 + 2e72ed2):
1. **Fetch + triage**: shallow-clone to `/tmp`, classify each repo: pure skill(s) / skill + tool (MCP server, CLI) / path-coupled package (internal relative routing → must stay one directory). Skills must pass the §9-audit name/dir check before copying.
2. **Security scan before install**: grep all scripts (`sh ps1 py js mjs`) for exfil patterns (`curl -d|--data|POST`, `sendBeacon`, `.upload(`) and enumerate every non-localhost domain — legit hits are package registries, docs, and test fixtures (`example.invalid`, `http://evil`); anything that phones home on load rejects the install. Skill files mentioning `curl`/`nmap` as METHODOLOGY TEXT are fine (inert); scripts that auto-execute are not.
3. **Weigh routing cost, then place**: `find <coll> -name SKILL.md -exec sed -n '/^description:/,/^---/p' {} \; | wc -c` — every global skill's description is injected into EVERY pi session (library baseline ~9KB/20 skills 2026-10). Small (≤ a few KB total) or single skills → global `skills/` + vendored-from pin (`repo @sha, vX.Y.Z, license`) in the skills README. Collection adding >~5KB → **vault + router**: full package unmodified at `~/.agents/skills-vault/<name>/` (gitignored, third-party content), ONE tracked router skill whose body carries the category/module index, the absolute vault path, and the exact `git clone` restore command (self-healing fresh clones). Body text is load-on-demand, so indexes there can be detailed.
4. **Boundary notes**: when a new skill touches an existing domain (antislop-ui vs impeccable), record the split in the README ("X filters, Y directs") instead of merging vendored files — keep upstream copies unmodified for clean re-vendors.
5. **Tools (MCP servers)**: register in BOTH `config/pi/mcp.json` (runtime source, has `description`/`env` keys) and root `mcp.json` (protocol mirror, `environment`/`transport` keys, `${ENV_VAR}` creds) in the SAME commit. Pin the package version (e.g. `rea-agents@6.0.0`) to match the vendored skill. Verify with a live stdio handshake (`initialize` + `tools/list` piped to the command) BEFORE registering.
6. **MCP + node engines trap**: plain `"command": "npx"` resolves through the PATH node (nvm default here), and an absolute `/opt/homebrew/bin/npx` still follows its `#!/usr/bin/env node` shebang — to force a specific node, pin the BINARY: `command: /opt/homebrew/bin/node`, args: `[/opt/homebrew/lib/node_modules/npm/bin/npx-cli.js, -y, pkg@ver, ...]`.
7. Commit skills (`feat(skills): …`) and MCP (`feat(mcp): …` in both files) separately, push, then re-run the §9 audit (name/dir, tracked-ness incl. `git check-ignore` for vaulted dirs).

## 9. Audit checklist (run when the library drifts)
Deliver findings as ✅ healthy / 🔴 broken / 🔀 merge / ➕ extend with evidence paths, and get a scope decision (report-only vs fix) before executing anything.
- **Name/dir match:** frontmatter `name` must equal the dir name. A mismatch usually means the body's own paths are broken too — hit: `nvidia-image-gen` with name `generate-img-nvidia`, all 4 `scripts/generate.py` paths dead. Print mismatches only, stripping quotes so quoted AND bare names both compare clean (a naive `awk -F'"' '{print $2}'` false-mismatches every unquoted or single-quoted frontmatter — 11/18 in the 2026-10-06 run):
  ```bash
  for d in */; do n=$(sed -n 's/^name:[[:space:]]*//p' "$d/SKILL.md" | head -1); n="${n%\"}"; n="${n#\"}"; n="${n%\'}"; n="${n#\'}"; [ "${d%/}" = "$n" ] || echo "MISMATCH: dir=${d%/} name=$n"; done
  ```
- **Body path existence:** grep bodies for `~/.agents/skills/<x>/` references and verify each target exists on disk. Also verify non-skill `~/` refs (e.g. `~/.agents/agents/visual.md`).
- **Tracked-ness:** `git ls-files <skill-dir>` empty → run `git check-ignore -v`. The .gitignore "local-only skills" section can silently untrack a portable skill (hit: pi-mcp-stdio-install ignored at `.gitignore:40` while its content was fully portable — a fresh clone would lose it). Vaulted dirs under `skills-vault/` are SUPPOSED to be ignored — their router skill must carry the restore command instead.
- **Uncommitted drift:** `git status --short skills/` — a modified constitution (this file) drifting uncommitted is itself a finding. An ` M` with empty `git diff` is stat-cache dirt, not drift.
- **Staleness:** per-skill `git log -1 --format='%ad' --date=short -- <dir> | sort` to spot abandoned vs actively maintained.
- **Duplication clusters:** read FULL bodies; the same trap fact appearing verbatim in ≥2 skills (e.g. headless-await hang, `cp -X` flash rule, CDC truncation across ZMK skills) is a §4 merge/overlay candidate and pre-drift.
- **Description honesty:** description claims must match the body's actual coverage (e.g. "ANY visual change" with no web branch = gap to fix or narrow the claim).
