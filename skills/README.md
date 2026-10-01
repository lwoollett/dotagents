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

- zmk-firmware-config — ZMK config repos for nice!nano (flat config, build.sh, 2026 API notes)
- ffkb-v2-zmk-loop — ffkb v2 build/flash/Cirque trackpad bring-up
- zmk-pin-diag — meter-less GPIO bus diagnostics for ZMK boards

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

- twoee-canon-pdf-lookup, module-pdf-run-aid-extract, adnd2e-magic-item-xp-gp-lookup (scanned TSR AD&D 2e library)

## Infra / meta

- askj-dev-db-provisioning — local dev Postgres :5566 for PrivateAI.API integration tests
- pi-mcp-stdio-install — adding stdio MCP servers to pi
- skill-writing — authoring, homologating, and deleting skills (this library's constitution)
