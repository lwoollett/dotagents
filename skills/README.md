# agent-skills

Shared skill library for pi / omp agents (`~/.agents/skills`). Each directory
is a self-contained skill: a `SKILL.md` with frontmatter (name, description)
and a markdown body of procedures, gotchas, and recipes.

## CAD / hardware design

- **fusion360-mcp-cad-builds** — the canonical Fusion 360 / STL skill:
  parametric builds via the MCP server's `execute_code`, 2026 API gotchas,
  boolean traps, heat-set insert posts, voronoi/hex/graded lattice recipes,
  real SIMP topology optimisation → CAD pipeline, sweepy generative finish,
  viewport renders for vision verification, fit-test coupons, export paths.
- vision-verify-ui defers CAD capture/verification to the skill above.

## Firmware

- zmk-firmware-config — ZMK config repos for nice!nano (flat config, build.sh,
  2026 API notes)
- ffkb-v2-zmk-loop — ffkb v2 build/flash/Cirque bring-up
- zmk-pin-diag — meter-less GPIO bus diagnostics for ZMK boards

## Also here

DevOps (ado-*), git/commit conventions, Godot, Dungeondraft, image generation,
D&D reference lookups, screenshot/impeccable frontend work.
