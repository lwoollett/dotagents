---
name: "godot-gdextension-cpp-build"
description: "Wrap a C++ static library as a Godot 4.7 GDExtension (CMake lib + godot-cpp SConstruct + .gdextension registration + headless bind tests) — use when building/ porting extensions like zxing to macOS or Android"
---

# Build a C++ GDExtension for Godot 4.x (wrapped static lib)

Use when wrapping a C++ library (zxing-cpp, box2d, etc.) as a Godot GDExtension — initial bring-up or adding a platform (macos → android arm64) to an existing one. Recipe proven on Godot 4.7.stable / macOS arm64 for zxing-cpp v3.1.1 (scanrace ext/zxing).

## Layout
```
ext/<name>/
  godot-cpp/      git clone --depth 1 --recursive godotengine/godot-cpp (master = current stable line)
  <lib>/          the wrapped library source (git submodules: update --init AFTER clone)
  build-<lib>/    CMake build dir of the static lib
  src/*.cpp       wrapper + register_types
  SConstruct
game/addons/<name>/<name>.gdextension   + bin/ outputs
```

## Steps
1. **Static lib via its native build** (CMake): `-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON` + disable tests/examples. Watch for: git submodules the wrapper needs (zxing-cpp 3.x pulls zint for encoding), and CMake-GENERATED headers (zxing's Version.h lands in build-<lib>/core — add that dir to the wrapper include path, not just the source dir).
2. **godot-cpp**: `scons platform=macos arch=arm64 target=template_debug api_version=4.7 -j8`. Master has no 4.x tags to autodetect from a shallow clone — pass `api_version=<engine minor>` explicitly, or the SConscript errors "must be provided". Bake the default into the wrapper SConstruct: `if "api_version" not in ARGUMENTS: ARGUMENTS["api_version"] = "4.7"`.
3. **Wrapper SConstruct**: `env = SConscript("godot-cpp/SConstruct")`, append `CPPPATH=["src/", lib source, CMake build dir]`, `LIBPATH/LIBS` for the static lib, `CXXFLAGS=["-std=c++20", "-fexceptions"]` if the lib needs them, then `env.SharedLibrary("<out>.dylib"/".so", Glob("src/*.cpp"))`.
4. **Registration**: register_types.cpp with `GDExtensionBool GDE_EXPORT <name>_library_entry(...)` using GDExtensionBinding::InitObject; entry_symbol must match. `.gdextension` file: `compatibility_minimum = "4.7"`, per-platform keys `macos.debug`, `macos.release` pointing at `res://addons/<name>/bin/...`.
5. **Register + load**: run `godot --headless --path game --import` once after adding the .gdextension — it writes `.godot/extension_list.cfg`; runtime runs only load extensions from that list. If import dies mid-run (Abort trap), `.godot` may be corrupted — wipe and re-import. After that, headless `-s` script runs CAN use the extension via `ClassDB.class_exists("<Class>")`.
6. **Bind test**: `ClassDB::bind_method(D_METHOD(...))` for every exposed method — a declared-but-undefined `_bind_methods` links fine per-TU then fails at dylib link with "symbol not found for architecture".
7. **Round-trip test in the suite**: if the lib has an encoder, encode→decode makes a camera/CI-independent test of the whole stack; pin normalization decisions (e.g. zxing reports UPC-A as 0-prefixed EAN-13 — collapse in the wrapper so all input paths produce identical strings).

## Gotchas
- GDScript consts: `PackedStringArray([...])` is NOT a constant expression — use plain array literals. Walrus `:=` on Variant/ClassDB-instantiated receivers fails to infer — annotate explicitly.
- A scene run without AutoShot firing simply idles forever (no error) — don't confuse with a hang; use `--quit-after N` to probe the main loop.
- Cross-platform note: android builds need NDK + `platform=android arch=arm64` and `.so` output; add `android.debug/release` keys to the .gdextension when that lands.
