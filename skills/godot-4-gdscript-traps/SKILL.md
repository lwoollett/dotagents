---
name: "godot-4-gdscript-traps"
description: "Recurring Godot 4.x GDScript and UI pitfalls — CanvasLayer control sizing, compile-time autoload resolution, import-gated class_names, Variant walrus inference, script-vs-C++ API surface, headless await traps; check before deep debugging"
---

# Godot 4 GDScript/UI traps (recurring, hard-won)

Durable engine gotchas found in real Godot 4.7 work — check before debugging deeper.

1. **Control under a CanvasLayer never gets sized.** `set_anchors_preset(PRESET_FULL_RECT)` only works with a Control parent; directly under a CanvasLayer (HUDs!) `size` stays 0×0 — everything derived from `size` (custom `_draw` positions, hit-test math) silently lands off-screen. Fix: `size = get_viewport_rect().size` in `_ready()`. Symptom: HUD labels in containers render, but free-positioned/`_draw` elements vanish while keyboard input still works.
2. **Autoload identifiers resolve at COMPILE time.** Referencing `MyAutoload` anywhere in a script — even in a branch that never runs — fails compilation when the script is loaded without autoloads (`-s` test/smoke scripts). Pattern: look up defensively (`_al("Name")` → `get_node_or_null("/root/Name")`) in any script a headless runner loads.
3. **New `class_name` scripts need an `--import` pass** before `-s` scripts resolve the global name (the class cache regenerates at import, not at file creation). Same for newly added `.gdextension` files (must register in `.godot/extension_list.cfg` via import).
4. **Walrus on Variant receivers fails to infer.** `var x := untyped.method()` or `dict.get(...)` → parse error "cannot infer". Annotate explicitly (`var hit: bool = ...`). Same family: const expressions can't call constructors — `PackedStringArray([...])` is not a const; a plain array literal is.
5. **Engine API ≠ script API.** Methods can exist in C++ but not be ClassDB-bound (CameraFeed.get_texture, get_base_width). The extension_api JSON in godot-cpp (`gdextension/extension_api-4.X.json`) is the authoritative script-visible surface — check it before guessing property names (e.g. `is_active()` method / `feed_is_active` property, not `isActive`).
6. **`await RenderingServer.frame_post_draw` never fires under `--headless`** (dummy renderer) — capture/quit helpers hang silently. Run captures windowed, each under a per-run watchdog (background + kill after N s); windowed runs occasionally hang environmentally too. `--quit-after N` frames is a quick main-loop health probe.
7. **Inserting a function before an existing one via edit-tool text replacement eats the following `func` declaration** if the new text doesn't re-append it — after any such edit, `grep -n "func "` the file to verify all declarations survived.

Not Godot but adjacent: vision-checking rendered effects — parameters that look visible to you (scanline alpha 0.05) can read as absent to a vision model at 720p; tune one notch stronger (0.09) when the checker reports "uniform black".
