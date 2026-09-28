---
name: "vision-verify-ui"
description: "Mandatory verification loop for any visual/UI change — AutoShot framebuffer capture (with env-driven auto-actions for stateful states), delegate to a vision-capable subagent (zai/glm-5.3-flash), iterate until CONFIRMED; time-lapse bursts for motion/physics bugs; composite-scoring for tile mating; strict delegation sizing"
---

# Vision-verify UI changes

## Rule
The main session model may not support image input. Never declare a visual/UI/scene/rendering change done without verification through a vision-capable subagent. This is a standing user rule. This covers BEHAVIOR (physics, motion, collisions), not just static layout.

## Procedure (scanrace / Godot / macOS)

1. **Capture via AutoShot (in-game framebuffer — the reliable path).** The game ships an opt-in autoload (`game/autoload/autoshot.gd`): run any scene with env vars and it waits, captures the viewport, saves, and quits cleanly:
   ```bash
   SKR_SHOT=/tmp/skr_check.png SKR_WAIT=4 "/Applications/Godot.app/Contents/MacOS/Godot" --path game res://scenes/scan/scanner.tscn
   ```
   - Positional scene path overrides the main scene; autoloads load normally (unlike `-s` scripts).
   - WAIT past countdowns/interactions (~7s); different screens = separate runs.
   - macOS `screencapture` from the agent's shell FAILS (no Screen Recording permission). Don't use it.
   - Wrap batch capture runs in a per-run watchdog (background + kill after N s): windowed runs occasionally hang environmentally. Retry flaky timestamps once or twice.
   - **Capturing post-interaction states (drop cards, dialogs, mid-animation):** don't script input — add env-var-driven auto-actions to the scene (e.g. `SKR_AUTOSCAN=<code>` makes the scanner auto-scan ~1.2s after ready). Cheap, deterministic, CI-able.
   - Delivering a shot to the user: copy to `~/Desktop/` with a descriptive name.
2. **Delegate the read** — keep it SMALL:
   ```
   subagent({agent: "delegate", model: "zai/glm-5.3-flash", async: false, task: "Read /tmp/x.png ... <checklist>"})
   ```
   **DELEGATION SIZING (hard-won, multiple timeouts):** glm-5.3-flash handles ONE frame with a 5-6 point checklist in seconds. Multi-frame deep-analysis tasks and big classification batches time out at the 30-minute cap mid-report. Structure time-lapses as compact per-frame table requests; on timeout, MINE THE TRANSCRIPT (`..._transcript.jsonl` in subagent-artifacts — assistant text blocks often contain the nearly-complete report). Connection errors leave EMPTY transcripts — nothing to mine, just retry as a single-frame task.
   Task must include: expected contents (exact strings, colors, positions), a wrongness checklist, and demands for measured pixel values on geometry checks.
3. **Act on findings, re-run the loop until CONFIRMED/CLEAN.** Ask for measurements — glm-5.3-flash measures pixel-exactly when given target colors, including full 2D sweeps. Size tuning converges in one iteration via measured ratios.

## Time-lapse verification (motion/physics/collision bugs)
- Run the SAME scene at increasing `SKR_WAIT` spanning the event (countdown + distance/speed arithmetic).
- Per frame ask: HUD numeric readouts (speed!), subject position, orientation, surface, overlap state — then interpret ACROSS frames. Prove motion by world landmarks, not screen coords (camera-follow artifact).
- Cover both autopilot and idle-player paths — perfect autopilots never trigger crash/free-node paths.

## Classifying assets (tiles/sprites) you cannot see
- **Programmatic analysis FIRST** (PIL): sizes, alpha, dominant colors, edge-band extents, arm centerlines.
- **Composite-scoring for tile mating**: compose candidate + neighbors in PIL, score junction continuity (span comparison at the seam), windows clamped per-tile or perpendicular tiles contaminate spans. Sweep rotations. Deterministic — no vision needed.
- Small vision delegations for semantics only (mini contact sheets ~9 tiles). Never batch-classify big sets.
- Watch for inverted color models: palette-PNG transparency reads as black; "empty-looking" tiles may be plain surface pads, not grass.

## Gotchas
- User-shared screenshots from macOS temp dirs vanish fast — copy immediately; Desktop is stable.
- Known-fixed layout facts (don't regress): `PRESET_BOTTOM_WIDE` needs `grow_vertical = BEGIN`; lifting off an edge = move that edge's offset (`offset_bottom`), not the opposite one; prefer `CenterContainer` + `set_anchors_and_offsets_preset`; `draw_set_transform` + `draw_rect` rects extend toward local +x/+y — center with negative-half origins.
- Verify sprite-art facing with a one-image delegation before writing rotation math (Kenney pack: cars and arrows face north).
- Godot runtime: nodes freed via `queue_free()` remain in Arrays until filtered — guard every access with `is_instance_valid(node)` in iteration loops AND list filters.
- Band-positioning math: decide explicitly whether `position` means the band's top or bottom edge; sign inversions draw grass over the road (bit us twice).
- GDScript Variant-inference is a HARD ERROR in this project: never `var x := dict.get(k, d)` or `var x := {…}.get(…)` or method chains on untyped refs — always annotate (`var x: String = …`). Also never write `def func` (Python muscle memory) in GDScript stubs.
