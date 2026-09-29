---
name: "vision-verify-ui"
description: "Mandatory verification loop for any visual/UI/scene/rendering change — AutoShot framebuffer capture for games, API viewport renders for desktop CAD, delegate to a vision-capable subagent (zai/glm-5.3-flash), iterate until CONFIRMED; time-lapse bursts for motion/physics bugs; strict delegation sizing"
---

# Vision-verify UI changes

## Rule
The main session model may not support image input. Never declare a visual/UI/scene/rendering change done without verification through a vision-capable subagent. This is a standing user rule. This covers BEHAVIOR (physics, motion, collisions), not just static layout — and applies to ANY rendered artifact: game frames, app UI, CAD viewport renders, generated images.

## Procedure (scanrace / Godot / macOS)

1. **Capture via AutoShot (in-game framebuffer — the reliable path).** The game ships an opt-in autoload (`game/autoload/autoshot.gd`): run any scene with env vars and it waits, captures the viewport, saves, and quits cleanly:
   ```bash
   SKR_SHOT=/tmp/skr_check.png SKR_WAIT=4 "/Applications/Godot.app/Contents/MacOS/Godot" --path game res://scenes/scan/scanner.tscn
   ```
   - Positional scene path overrides the main scene; autoloads load normally (unlike `-s` scripts).
   - WAIT past countdowns/interactions (~7s); different screens = separate runs.
   - macOS `screencapture` from the agent's shell FAILS (no Screen Recording permission). Don't use it.
   - Wrap batch capture runs in a per-run watchdog (background + kill after N s): windowed runs occasionally hang environmentally. Retry flaky timestamps once or twice.
   - **Capturing post-interaction states (drop cards, dialogs, mid-animation):** don't script input — add env-var-driven auto-actions to the scene. Cheap, deterministic, CI-able.
   - Delivering a shot to the user: copy to `~/Desktop/` with a descriptive name.
1a. **Desktop-CAD captures (Fusion 360, proven):** don't screenshot the app — render from the API: `viewport.saveAsImageFile(path, w, h)` after setting the camera programmatically (`vp.camera` eye/target/upVector + `vp.fit()`). Verify the RENDER'S FRAMING with a vision delegation before judging geometry — mis-framed renders produce confident false verdicts (a "front wall" shot that was actually isometric read as "no voronoi pattern" for 3 iterations).
2. **Delegate the read** — keep it SMALL:
   ```
   subagent({agent: "delegate" or a vision agent, model: "zai/glm-5.3-flash", async: false, task: "Read /tmp/x.png ... <checklist>"})
   ```
   **DELEGATION SIZING (hard-won, multiple timeouts):** glm-5.3-flash handles ONE frame with a 5-6 point checklist in seconds. Multi-frame deep-analysis tasks and big classification batches time out. Structure time-lapses as compact per-frame table requests; on timeout, MINE THE TRANSCRIPT (`..._transcript.jsonl` in subagent-artifacts). Connection errors leave EMPTY transcripts — retry as single-frame.
   **ONE subagent call per turn** — parallel calls are rejected ("a subagent call is already in progress"); fan out across sequential turns.
   Task must include: expected contents (exact strings, colors, positions), a wrongness checklist, and demands for measured pixel values on geometry checks. A purpose-built `visual` user agent (read tool, glm-5.3-flash) beats generic delegate.
3. **Act on findings, re-run the loop until CONFIRMED/CLEAN.** Ask for measurements — glm-5.3-flash measures pixel-exactly when given target colors. Vision feedback often names the ROOT CAUSE: "openings are uniform rectangles" on CAD walls revealed a vertical-prism-cut limitation and collinear-seed bisectors — treat descriptions as diagnostics, not just pass/fail. Also distinguish STRUCTURE defects (fix and re-run) from taste parameters (density/size) — the latter go to the user with renders copied to ~/Desktop.

## Time-lapse verification (motion/physics/collision bugs)
- Run the SAME scene at increasing `SKR_WAIT` spanning the event.
- Per frame ask: HUD numeric readouts (speed!), subject position, orientation, surface, overlap state — then interpret ACROSS frames. Prove motion by world landmarks, not screen coords (camera-follow artifact).
- Cover both autopilot and idle-player paths.

## Classifying assets (tiles/sprites) you cannot see
- **Programmatic analysis FIRST** (PIL): sizes, alpha, dominant colors, edge-band extents, arm centerlines.
- **Composite-scoring for tile mating**: compose candidate + neighbors in PIL, score junction continuity at the seam; windows clamped per-tile. Sweep rotations. Deterministic.
- Small vision delegations for semantics only (mini contact sheets ~9 tiles). Never batch-classify big sets.
- Watch for inverted color models: palette-PNG transparency reads as black.

## Gotchas
- User-shared screenshots from macOS temp dirs vanish fast — copy immediately; Desktop is stable.
- Verify sprite-art facing with a one-image delegation before writing rotation math.
- CAD camera APIs: `viewport.camera` often returns a singleton — setting `viewOrientation` on it may not override stale eye/target; set eye/target/upVector explicitly and far away (≈500+mm) for quasi-orthographic elevations.
