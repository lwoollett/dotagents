# Shared agent skills (`~/.agents/skills`)

Skill library for pi. Each directory is a self-contained
skill: a `SKILL.md` with frontmatter (name, description) and a markdown body
of procedures, gotchas, and recipes. Authoring/homologation rules live in the
**skill-writing** skill. The whole tree is the `dotagents` git repo — commit
skill changes there, never nest a git repo.

## CAD / hardware design

- **fusion360-mcp-cad-builds** — the canonical Fusion 360 / STL skill:
  parametric builds via the MCP server's `execute_code`, 2026 API gotchas,
  boolean traps, heat-set insert posts, voronoi/hex/graded lattice recipes,
  real SIMP topology optimisation → CAD pipeline, sweepy generative finish,
  viewport renders for vision verification, fit-test coupons, export paths.
- vision-verify defers CAD capture/verification to the skill above.
- engineering-drawing — vendored from earthtojake/text-to-cad @ v0.7.17 (MIT):
  ISO drawing PDFs (views, hidden lines, measured dims, hole callouts, title block)
  from any STEP file via `uvx --from cadgen==0.7.17` — pairs with Fusion STEP exports.
- step-parts — vendored from text-to-cad @ v0.7.17 (MIT): step.parts catalog search +
  STEP download of real standard parts (screws, bearings, standoffs, servos, boards);
  stdlib-only downloader; insert into Fusion builds instead of placeholder geometry.
- dfam-check — vendored from text-to-cad @ v0.7.17 (MIT): mesh printability gate
  (wall thickness, overhangs, support area, orientations) per process (FDM/SLS/SLA/PBF/MJF);
  run on Fusion STL exports before printing; deps via `uvx --with trimesh ...`.

## Firmware / keyboards

- zmk — ZMK firmware on nice!nano in three parts: generic config-repo recipe (flat layout, build.sh, 2026 API notes), ffkb v2 board overlay (build/flash/Cirque trackpad bring-up, I²C no-ACK triage), meter-less GPIO pin/bus diagnostics (merged from zmk-firmware-config + ffkb-v2-zmk-loop + zmk-pin-diag)

## Code review / git

- branch-review-parallel — branch/diff review + verified fix fan-out; carries the PrivateAI.API adversarial overlay
- commit-style — Conventional Commits, intent-compressed

## Azure DevOps

- ado-boards — Kanban boards (read free, writes as confirmed diffs)
- ado-pipelines — CI failure triage, real errors from logs (read-only)
- ado-pr-review — PR review in chat only; includes az CLI + REST fallback when MCP tools aren't mounted

## Games / engines

- godot — §1 GDScript/UI traps + §2 GDExtension C++ builds (consolidated 2026-10-06 from godot-4-gdscript-traps + godot-gdextension-cpp-build; headless-await trap canonical here) · dungeondraft-modding

## Security / offensive

- claude-red — ROUTER to 79 offensive-security skills (SnailSploit/claude-red @ 739512a, MIT) vaulted at ../skills-vault/claude-red; web/wireless/exploit-dev/privesc/AD/post-ex/fuzzing/OSINT methodology, read-on-demand; authorized engagements/CTF only
- reverse-skill — ROUTER to the reverse-skill package @ cab634b (44 scenario skills + 42 CTF orchestrator sub-skills, consent-gated ops: master-route → case-init → scope.md before any target action) vaulted at ../skills-vault/reverse-skill
- reverse-engineer-anything — vendored from morluto/rea @ 2a4979b (skill v33): live binary/Electron/JS/.NET analysis via the `rea` MCP server (npm rea-agents 6.0.0, registered in config/pi/mcp.json on brew node 26)

## Frontend / media

- antislop (+ -ui, -code, -copywriting, -layoutmobile, -human) — vendored from miqdadbadjuber/anti-slop @ 388cbe3 (v3.2.20, MIT): slop FILTER (no generic UI/filler copy/AI-shaped code); complements impeccable, which supplies design direction — antislop removes, impeccable directs
- logo-design — vendored from kaankiziltug/logo-design-skill @ 0ecf52e (v1.4.4, MIT): brief → concepts → SVG construction → 16px/one-colour/shelf tests → kit; bundles 1,400-logo classified SVG reference library + dependency-free python tools (13 MB, tracked deliberately — the library is the value)
- impeccable — vendored from pbkaus/impeccable (v4.3.1) WITH local modifications (bounded verification passes); a re-vendor will clobber them — diff before updating
- screenshots (Playwright capture), nvidia-image-gen (FLUX via NiM)
- vision-verify — generic vision verification of any screenshot/media: read directly if the session model is vision-capable, else delegate to the `visual` agent (glm-5.3-flash bound in `~/.agents/agents/visual.md`) and iterate until CONFIRMED; game/CAD/web/asset-sheet/hardware-photo specifics inside

## Reference / hobby

- adnd2e-magic-item-xp-gp-lookup — 2e magic item XP/GP canon (DMG + Encyclopedia Magica via fandom wiki API); self-contained, usable anywhere
- (twoee-canon-pdf-lookup + module-pdf-run-aid-extract now live repo-local: ~/repos/twoee/.agents/skills/ — they are path-coupled to that tree's data/)

## Infra / meta

- autoresearch — vendored from uditgoenka/autoresearch @ 050e30d (v2.2.2, MIT; after Karpathy's autoresearch): autonomous goal→metric→loop iteration (plan/probe/debug/fix/security/ship/scenario/predict/reason subcommands as sibling .md files)
- askj-dev-db-provisioning — local dev Postgres :5566 for PrivateAI.API integration tests
- skill-writing — authoring, homologating, and deleting skills (this library's constitution)
