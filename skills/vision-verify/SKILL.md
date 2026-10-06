---
name: "vision-verify"
description: "Verify any image, screenshot, video frame, or media the session can't see or shouldn't judge unread — game frames, app UI, web screenshots, CAD viewport renders, photos of hardware, generated images, tile/sprite sheets. Delegate to a vision-capable subagent when the session model can't see images; iterate until CONFIRMED."
---

# Vision-verify screenshots & media

Generic procedure for getting trustworthy readings of visual media, with specifics per use case found so far (games, CAD, web, asset sheets, hardware photos, reference extraction).

## Rule

Never declare a visual/UI/scene/rendering change done — or answer a question *about* an image — on unverified assumption. This is a standing user rule. Covers BEHAVIOR (physics, motion, collisions), not just static layout, and ANY rendered artifact: game frames, app UI, web pages, CAD viewport renders, photos of hardware, generated images, asset sheets.

1. **If this session's model is vision-capable** (the `read` tool returns images as attachments): read the image(s) directly and verify yourself. Don't assume either way — test with one read or fall through to delegation.
2. **Otherwise delegate the read** per the protocol below and iterate until CONFIRMED/CLEAN.

## Delegation protocol (generic)

- Delegate via the `visual` agent — `subagent({agent: "visual", task: "Read /tmp/x.png … <checklist>"})`. Its definition (`~/.agents/agents/visual.md`, discovered via `subagents.agentScanDirs` in pi settings) binds model `glm-5.3-flash` (zai, vision-capable) + read/write tools + a vision-analyst prompt — the model binding is guaranteed by pi-subagents config, not by remembering a model hint. Fallback if the agent is unavailable: generic `delegate` with an explicit `model: "zai/glm-5.3-flash"`.
- **Sizing (hard-won, multiple timeouts):** glm-5.3-flash handles ONE frame with a 5–6 point checklist in seconds. Multi-frame deep-analysis tasks and big classification batches time out. Structure time-lapses as compact per-frame table requests; on timeout, MINE THE TRANSCRIPT (`..._transcript.jsonl` in subagent-artifacts). Connection errors leave EMPTY transcripts — retry as single-frame.
- **ONE subagent call per turn** — parallel calls are rejected ("a subagent call is already in progress"); fan out across sequential turns.
- Task must include: expected contents (exact strings, colors, positions), a wrongness checklist, and demands for measured pixel values on geometry checks. The `visual` agent's report shape (verdict / text extracted / observations / issues / recommended fix) fits this — write the checklist to fill it.
- **Act on findings, re-run until CONFIRMED.** Vision feedback often names the ROOT CAUSE ("openings are uniform rectangles" on CAD walls revealed a vertical-prism-cut limitation and collinear-seed bisectors) — treat descriptions as diagnostics, not just pass/fail. Distinguish STRUCTURE defects (fix and re-run) from taste parameters (density/size) — the latter go to the user with renders copied to ~/Desktop.

## Media-reading limits (cross-cutting)

- Vision is reliable for extracting GROUND TRUTH (specific elements, coordinates, per-element Q&A) and unreliable for holistic quality judgments — it hallucinates features. Compare against quantitatively extracted references, not vibes.
- Vision reads of small passives/hardware detail are unreliable — the user's eyes on hardware win.
- HEIC photos: convert with `sips -s format jpeg` before any read. AVIF likewise: `sips -s format png in.avif --out out.png` (the `read` tool accepts only jpg/png/gif/webp/bmp, and AVIF is common from web/vendor CDN image links).
- User-shared screenshots from macOS temp dirs vanish fast — copy immediately; Desktop is stable.
- Parameters visible to you (scanline alpha 0.05) can read as absent to a vision model at 720p — tune one notch stronger when the checker reports "uniform black".
- macOS `screencapture` from the agent's shell FAILS (no Screen Recording permission). Capture via the use-case paths below instead.

## Use-case specifics

### A. Games / Godot (AutoShot framebuffer capture — the reliable path)

1. The game ships an opt-in autoload (`game/autoload/autoshot.gd`): run any scene with env vars and it waits, captures the viewport, saves the frame, and quits cleanly:
   ```
   SKR_SHOT=/tmp/skr_check.png SKR_WAIT=4 "/Applications/Godot.app/Contents/MacOS/Godot" --path game res://scenes/scan/scanner.tscn
   ```
   - Run WINDOWED, never `--headless`: AutoShot's `await RenderingServer.frame_post_draw` NEVER resolves under the headless dummy renderer — the process idles forever with no error. ("Works headless of screen-recording permission" historically meant TCC-independent, not `--headless` mode.) Always wrap in a per-run watchdog (background + kill after N s) since windowed runs also occasionally hang environmentally.
   - Positional scene path overrides the main scene; autoloads load normally (unlike `-s` mode).
   - WAIT past countdowns/interactions (~7s); different screens = separate runs.
   - Retry flaky timestamps once or twice.
   - **Capturing post-interaction states (drops, dialogs, mid-animation):** don't script input — add env-var-driven auto-actions to the scene. Cheap, deterministic, CI-able.
   - **Delivering a shot to the user:** copy to `~/Desktop/` with a descriptive name.
   - **Debugging hung capture runs**: check whether SKR_SHOT/SKR_WAIT env vars were actually on the command, and remember a scene run without AutoShot firing simply idles — grep the log before assuming a code hang. `--quit-after N` (frames) is a quick main-loop health probe.
   - **Godot 4.7 GDExtension note:** adding a `.gdextension` requires a `--headless --import` pass to register it in `.godot/extension_list.cfg`; an import that dies mid-run (Abort trap) corrupts `.godot` — wipe and re-import. Scene-mode runs then load the extension fine.

### B. Desktop-CAD captures (Fusion 360)

See the canonical `fusion360-mcp-cad-builds` skill, item 11a — viewport renders (`vp.saveAsImageFile`), the camera-singleton gotcha (set eye/target/upVector explicitly, never `viewOrientation`), framing verification, low-angle underside shots. CAD geometry verification belongs to that skill.

### C. Web UI (browser capture)

Capture with the `screenshots` skill (playwright-cli: viewport/element/full-page/responsive sweeps) and **attach the image inline** to the reply — a UI change without a screenshot is an incomplete answer. Delegate the READ (per the protocol above) only when the session model can't see it. For visual regression across builds, use Playwright's `expect(locator).toHaveScreenshot()` baselines instead of ad-hoc comparison.

### D. Asset sheets (tiles/sprites you cannot see)

- Programmatic analysis FIRST (PIL): sizes, alpha, dominant colors, edge-band extents, arm centerlines.
- Composite-scoring for tile mating: compose candidate + neighbors in PIL, score junction continuity at the seam; windows clamped per-tile. Sweep rotations. Deterministic.
- Small vision delegations for semantics only (mini contact sheets ~9 tiles). Never batch-classify big ones.
- Watch for inverted color models: palette-PNG transparency reads as black.
- Verify sprite-art facing with a one-image delegation before writing rotation math.

### E. Time-lapse verification (motion/physics/collision bugs)

- Run the SAME scene at increasing `SKR_WAIT` spanning the event.
- Per frame ask: HUD numeric readouts (speed!), subject position, orientation, collision/overlap state — then interpret ACROSS frames. Prove motion by world landmarks, not screen coords (camera-follow artifact).
- Cover both autopilot and idle-player paths.

### F. Hardware photos & reference extraction

- Photos of boards/passives: convert HEIC→JPEG, but treat vision conclusions as hints — multimeter-less electrical diagnosis belongs to the `zmk` skill §3 (GPIO classification), not vision.
- Recreating a reference (maps, layouts, screenshots): extract the layout QUANTITATIVELY first — targeted vision queries asking for percent-grid centers/sizes/shapes of every element and connection lists. Never build from prose descriptions; layout fidelity is the dominant quality factor. Vision Q&A then serves as ground-truth spot checks, not final judge.
- Export/review loops: full-map screenshots must set zoom to fit BOTH axes (too-tight zoom silently crops content and fakes "missing" features).

### G. Live-webcam scenes (macOS TCC)

macOS TCC can leave CameraServer feeds enumerated-but-inactive; verification of camera viewfinders may need the user to click Allow once (`tccutil reset Camera <bundle-id>` re-arms the prompt). Code must fall back gracefully to a no-camera state and THAT state must be vision-verified in the meantime.
