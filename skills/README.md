# Shared agent skills (`~/.agents/skills`)

Skill library shared by pi / omp agents. Each directory is a self-contained
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
- vision-verify-ui defers CAD capture/verification to the skill above.

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

- godot-4-gdscript-traps, godot-gdextension-cpp-build, dungeondraft-modding

## Frontend / media

- impeccable, screenshots (Playwright capture), nvidia-image-gen (FLUX via NiM)

## Reference / hobby

- adnd2e-magic-item-xp-gp-lookup — 2e magic item XP/GP canon (DMG + Encyclopedia Magica via fandom wiki API); self-contained, usable anywhere
- (twoee-canon-pdf-lookup + module-pdf-run-aid-extract now live repo-local: ~/repos/twoee/.agents/skills/ — they are path-coupled to that tree's data/)

## Infra / meta

- askj-dev-db-provisioning — local dev Postgres :5566 for PrivateAI.API integration tests
- skill-writing — authoring, homologating, and deleting skills (this library's constitution)
