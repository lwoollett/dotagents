---
name: dungeondraft-modding
description: "Develop, decompile, and debug Dungeondraft (Godot 3 Mono) mods and automation bridges — loader semantics, silent-failure traps, config persistence, UI driving, pattern/asset semantics, reference-map recreation recipe"
---

# Dungeondraft mod/bridge debugging & development

For building or debugging Dungeondraft (1.2.x, Godot 3.4.2 Mono) mods, or any tooling that drives the running app. Grounded in live debugging + decompilation of Dungeondraft.dll.

## Toolchain setup
- Decompile: extract `Contents/Resources/Dungeondraft.pck` (Godot 3 format: magic GDPC, u32 ver fields, 16 reserved u32, u32 count, entries path/offset(u64)/size(u64)/md5; paths res:// prefixed). The game logic is `res://.mono/assemblies/Release/Dungeondraft.dll` (the .cs files in the pck are 1-byte stubs). Use `ilspycmd` (dotnet tool) — `ilspycmd Dungeondraft.dll -t <ClassName>` per class; ModManager, ModScript, Editor, Master, Exporter, World, Level, Lights, Save, PatternShape are the key classes.
- Parse-check mod .gd like the real loader: compile `"var Global = {}\nvar Script=null\n\n" + source` with `GDScript.new(); set_source_code(); reload()` inside a headless Godot 3.4.2 (`--no-window -s script.gd`; the checker process may hang after quit() — wrap with `timeout`).
- Run the app with captured stdout for logs: `nohup .../MacOS/Dungeondraft > log 2>&1 & disown` (plain `&` children die with the shell's process group).

## Mod rules (violations crash the app)
- No `extends` line anywhere in a tool script; don't declare `Global`/`Script` members (loader prepends them).
- Lifecycle: `start()` after every map setup (once per accumulated instance), `update(delta)` every frame on ALL instances; each instance's Global snapshots World at ITS load — keep one socket owner and inject fresh Globals into it (park it in scene-tree root meta; park the TCP_Server in root meta too so map-closes can't leak its fd — successors adopt it).
- GDScript 3 only; no try/catch (isolate risky calls in their own functions); C# statics and System.Action params unreachable from GDScript; custom C# classes don't marshal.
- Never `Reload(keepState:true)` a structurally changed script (added/removed vars) — hard crash.

## Silent-failure traps
- Programmatic lights need a texture AND `set_meta("preview", false)` or every save NREs silently (async task, no log).
- UniversalVTT export needs `World.SetSourceLevel(CurrentLevelId)` when SourceLevel is null.
- config.ini (`~/Library/Application Support/Dungeondraft/`) is rewritten from memory on quit — patch only while the app is quit. Keys: [Mods] mods_directory + active_mods (unique_ids); [Assets] custom_assets_directory + active_asset_packs (pack IDs from pack.json inside the .dungeondraft_pack PCK).
- New Map from an open map = Global.Restart() (app restarts to welcome screen); ChangeMapSize window is safe to drive — its spinbox deltas are GRID CELLS (not woxels), shrinking clamps at half the current size per call.
- **Export/save race wedges the app**: `Save.Start` sets `Master.IsSaving=true` and never resets it if interrupted; an export+save race leaves `Master.IsBusy` stuck → all later saves AND auto-backups silently no-op (no modal). Only an app restart cures it. Always save FIRST, then export, with settle time between. Diagnosis hint: if auto-backups in user://backups stopped while an old one exists, the flag is stuck.
- Element node ids in a FRESH session start low (~100): purge/delete sweeps must scan ids from 1, or stale shapes silently survive under a rebuild.

## Pattern/terrain/asset semantics (blueprint-pack findings)
- Pattern shapes: `patterns/normal/white.webp` + any tint = OPAQUE fill of that tint (solid rects/gons); `black.webp` + tint = opaque dark. Line-art patterns (`*_water`, `*_grid`) are TRANSPARENT overlays — tint only tints their marks, never fills.
- Pure `#ffffff`-near tints (>=~0.93 luminance) render INVISIBLE via SetOptions; use #f2efe8-class off-whites.
- Pack naming: prefix `black_`/`white_` in DnDungeon Blueprint = black-BASED vs white-BASED variants; `!_` prefixes force alphabetical-first.
- DD Pathways (draw_path) ALWAYS render yellow-tinted (the gradient shader's default) regardless of texture — unusable for white line work; use small polygon shapes instead (rungs, bolts, stools as squares).
- Cave system (dig_cave): floor texture applies per-dig region (not global), and DD's auto-generated cave WALLS render as dark torn blobs — for clean maps skip caves entirely.
- **Map-building recipe that works** (proven on a full keyed dungeon): floors = jittered 22-gon "blobs" (per-vertex ±20% radius noise) per chamber + offset-rect segments per corridor, each drawn TWICE — inflated dark polygon (r+0.3 cells) under a light fill → dark outline rings make rooms read as outlined caves. Explicit z layers per category (e.g. -100 outlines, -99 floors, -98 shore, -97 water, -96 furniture/marks, -95 banner) since same-z order is unreliable. Rounded corridor endpoints via small blob caps.
- Element descriptors for patterns report position [0,0] (polygon-local) — target them by creation order/id, not position.

## Recreating a reference map (procedure)
1. Extract the reference layout QUANTITATIVELY first: targeted vision queries asking for percent-grid centers/sizes/shapes of every room, the water bodies, special features, and the full corridor connection list. Never build from prose descriptions — layout fidelity is the dominant quality factor.
2. Map percent → cells (canvas W×H), build via the recipe above, label with `add_text` (sizes in WOXels: ~60 for room numbers, ~100 titles; colors per background — dark text on light floors, light on dark hatch).
3. Export review loop: full-map screenshots must set zoom to fit BOTH axes (too-tight zoom silently crops top/bottom rows and fakes "missing" content). Vision Q&A is reliable for extracting ground truth and checking specific elements, unreliable for holistic quality judgments (hallucinates features) — compare against the reference's extracted coordinates instead.
4. Save the .dungeondraft_map BEFORE any export (see busy-flag trap); export png/dd2vtt sequentially with ~10s settle.

## Verification pattern
Drive the running app over a mod TCP bridge (see dd_mcp repo, protocol v17, port 8787). Verify saves/exports by polling the output file; verify UI state via a scene-tree dump command (`get_node_tree`).
