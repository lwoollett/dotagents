---
name: "godot"
description: "Recurring Godot 4.x engine traps and the GDExtension C++ build recipe — GDScript/UI pitfalls (CanvasLayer control sizing, compile-time autoload resolution, import-gated class_names, Variant walrus inference, script-vs-C++ API surface, headless await hangs) plus wrapping a C++ static lib as a GDExtension (CMake lib + godot-cpp SConstruct + .gdextension registration + headless bind tests, macOS/Android). Check before deep Godot debugging, or when building/porting extensions like zxing."
---

# Godot 4 — GDScript traps & GDExtension C++ builds

One home for Godot 4 engine knowledge in two parts: **§1** recurring GDScript/UI traps · **§2** wrapping a C++ static library as a GDExtension. (Map-making in Dungeondraft is the separate `dungeondraft-modding` skill; in-game viewport capture for vision verification is `vision-verify` §A, which defers engine traps here.)

## §1. GDScript/UI traps (recurring, hard-won)

Durable engine gotchas found in real Godot 4.7 work — check before debugging deeper.

1. **Control under a CanvasLayer never gets sized.** `set_anchors_preset(PRESET_FULL_RECT)` only works with a Control parent; directly under a CanvasLayer (HUDs!) `size` stays 0×0 — everything derived from `size` (custom `_draw` positions, hit-test math) silently lands off-screen. Fix: `size = get_viewport_rect().size` in `_ready()`. Symptom: HUD labels in containers render, but free-positioned/`_draw` elements vanish while keyboard input still works.
2. **Autoload identifiers resolve at COMPILE time.** Referencing `MyAutoload` anywhere in a script — even in a branch that never runs — fails compilation when the script is loaded without autoloads (`-s` test/smoke scripts). Pattern: look up defensively (`_al("Name")` → `get_node_or_null("/root/Name")`) in any script a headless runner loads.
3. **New `class_name` scripts need an `--import` pass** before `-s` scripts resolve the global name (the class cache regenerates at import, not at file creation). Same for newly added `.gdextension` files (must register in `.godot/extension_list.cfg` via import — full procedure in §2 step 5).
4. **Walrus on Variant receivers fails to infer.** `var x := untyped.method()` or `dict.get(...)` → parse error "cannot infer". Annotate explicitly (`var hit: bool = ...`). Same family: const expressions can't call constructors — `PackedStringArray([...])` is not a const; a plain array literal is.
5. **Engine API ≠ script API.** Methods can exist in C++ but not be ClassDB-bound (CameraFeed.get_texture, get_base_width). The extension_api JSON in godot-cpp (`gdextension/extension_api-4.X.json`) is the authoritative script-visible surface — check it before guessing property names (e.g. `is_active()` method / `feed_is_active` property, not `isActive`).
6. **`await RenderingServer.frame_post_draw` never fires under `--headless`** (dummy renderer) — capture/quit helpers hang silently. Run captures windowed, each under a per-run watchdog (background + kill after N s); windowed runs occasionally hang environmentally too. `--quit-after N` frames is a quick main-loop health probe. (This is the canonical copy — `vision-verify` §A and §2 below defer here.)
7. **Inserting a function before an existing one via edit-tool text replacement eats the following `func` declaration** if the new text doesn't re-append it — after any such edit, `grep -n "func "` the file to verify all declarations survived.

Not Godot but adjacent: vision-checking rendered effects — parameters that look visible to you (scanline alpha 0.05) can read as absent to a vision model at 720p; tune one notch stronger (0.09) when the checker reports "uniform black".

## §2. Build a C++ GDExtension for Godot 4.x (wrapped static lib)

Use when wrapping a C++ library (zxing-cpp, box2d, etc.) as a Godot GDExtension — initial bring-up or adding a platform (macos → android arm64) to an existing one. Recipe proven on Godot 4.7.stable / macOS arm64 for zxing-cpp v3.1.1 (scanrace ext/zxing).

## Layout
```text
ext/<name>/
  godot-cpp/      git clone --depth 1 --recursive godotengine/godot-cpp (master = current stable line)
  <lib>/          the wrapped library source (git submodules: update --init AFTER clone)
  build-<lib>/    CMake build dir of the static lib
  src/*.cpp       wrapper + register_types
  SConstruct
game/addons/<name>/<name>.gdextension   + bin/ outputs
```

## Steps
1. **Static lib via its native build** (CMake): `-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON` + disable tests/examples. Watch for: git submodules the wrapper needs (zxing-cpp 3.x pulls zint for encoding), and CMake-GENERATED headers (zxing's Version.h lands in `build-<lib>/core` — add that dir to the wrapper include path, not just the source dir).
2. **godot-cpp**: `scons platform=macos arch=arm64 target=template_debug api_version=4.7 -j8`. Master has no 4.x tags to autodetect from a shallow clone — pass `api_version=<engine minor>` explicitly, or the SConscript errors "must be provided". Bake the default into the wrapper SConstruct: `if "api_version" not in ARGUMENTS: ARGUMENTS["api_version"] = "4.7"`.
3. **Wrapper SConstruct**: `env = SConscript("godot-cpp/SConstruct")`, append `CPPPATH=["src/", lib source, CMake build dir]`, `LIBPATH/LIBS` for the static lib, `CXXFLAGS=["-std=c++20", "-fexceptions"]` if the lib needs them, then `env.SharedLibrary("<out>.dylib"/".so", Glob("src/*.cpp"))`.
4. **Registration**: register_types.cpp with `GDExtensionBool GDE_EXPORT <name>_library_entry(...)` using GDExtensionBinding::InitObject; entry_symbol must match. `.gdextension` file: `compatibility_minimum = "4.7"`, per-platform keys `macos.debug`, `macos.release` pointing at `res://addons/<name>/bin/...`.
5. **Register + load**: run `godot --headless --path game --import` once after adding the .gdextension — it writes `.godot/extension_list.cfg`; runtime runs only load extensions from that list. If import dies mid-run (Abort trap), `.godot` may be corrupted — wipe and re-import. After that, headless `-s` script runs CAN use the extension via `ClassDB.class_exists("<Class>")`.
6. **Bind test**: `ClassDB::bind_method(D_METHOD(...))` for every exposed method — a declared-but-undefined `_bind_methods` links fine per-TU then fails at dylib link with "symbol not found for architecture".
7. **Round-trip test in the suite**: if the lib has an encoder, encode→decode makes a camera/CI-independent test of the whole stack; pin normalization decisions (e.g. zxing reports UPC-A as 0-prefixed EAN-13 — collapse in the wrapper so all input paths produce identical strings).

## Gotchas
- GDScript const/walrus pitfalls when writing test scripts for the extension — §1 trap 4 owns these verbatim.
- A scene run without AutoShot firing simply idles forever (no error) — don't confuse with a hang; use `--quit-after N` to probe the main loop.
- Cross-platform note: android builds need NDK + `platform=android arch=arm64` and `.so` output; add `android.debug/release` keys to the .gdextension when that lands.
