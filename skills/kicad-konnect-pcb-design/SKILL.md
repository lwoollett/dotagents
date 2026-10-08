---
name: "kicad-konnect-pcb-design"
description: "Use when designing PCBs in KiCad 10 via the Konnect MCP server (schematic capture, footprints, board placement, routing, fab exports) — transport split (file vs live-IPC), the KiCad ≥10.0.7 version requirement, KiCad-10 lib renames that silently drop symbols, label-collision and pin-crossing wiring traps, netlist-verification discipline, kicad-cli export recipes."
---

# KiCad 10 PCB design via Konnect MCP

Driving Konnect (the KiCad-10 MCP server) for schematic→board work. Proven on the void16 main-PCB build (2026-10). Assumes Konnect installed per `~/.agents` memory.

## Session start
1. `load_user_config` (fab constraints, passives); `list_toolboxes` then `load_toolset([...])` — only the project/config starter kit is loaded by default. Relevant sets: `sch_components`, `sch_wiring`, `sch_analysis`, `sch_export`, `pcb_board`, `pcb_components`, `pcb_routing`, `pcb_export`, `verification`, `library`.
2. Call tools from **codemode** (`tools.mcp__konnect__<name>`); fetch exact arg schemas with `describeTool` — several differ from the obvious guess (`add_board_text` takes `size` not height; `delete_schematic_net_label` needs `net`+`x`+`y`; `register_footprint_library` takes `nickname`/`library_path`/`project`/`scope`).

## Transport split (critical)
- **File-based (work without KiCad running):** all schematic tools, `create_footprint`, `register_footprint_library`, `add_board_outline`, `place_component`, `add_mounting_hole`, `add_board_text`, kicad-cli exports, `get_board_info`, and `run_drc` (falls back to the SAVED FILE via kicad-cli when live IPC is unavailable — parity violations then reflect the unsynced file, not the live board).
- **Live-IPC only:** `update_pcb_from_schematic` (net sync), live board ops. IPC socket file can EXIST while stale — "connection refused" means KiCad's API server is off (Preferences → Plugins → Enable KiCad API, restart, open the project).

## Trap 0 — KiCad version requirement (hit 2026-10-06)
Konnect 0.13's sync/discovery layer calls `kiapi.common.commands.GetOpenDocuments`, which **KiCad 10.0.1 does not implement** (`AS_UNHANDLED`), so `update_pcb_from_schematic` and open-board detection fail even with the API enabled and the board open. Needs KiCad ≥ 10.0.7 (the version Konnect's own notes reference). Also: `launch_kicad_ui({project})` opens a new KiCad project window EVERY call — calling it repeatedly (e.g. bare + with project) spawns duplicate windows the user has to close; call it once.

## Trap 1 — stale lib_ids silently vanish
KiCad 10 renamed symbols/footprints: `Switch:SW_Push`, `Device:RotaryEncoder` (3 pins numbered **A/B/C**), `Resistor_SMD:R_0402_1005Metric`. Placing a stale lib_id (`Device:SW_Push`) reports SUCCESS, later tool calls "succeed" against it, but the symbol never persists — it vanishes on the next file rewrite. **After any bulk placement: verify `export_netlist_summary` component_count equals what you placed** and every reference is present. `search_symbols` is single-token only (multi-word queries return 0).

## Trap 2 — label/wire coincidences corrupt nets (the big one)
`connect_to_net` draws a stub + net label. Three failure modes, all silent until verified:
- Two labels landing on the SAME point with different names merge nets (ERC: `multiple_net_names`).
- Deleting a label leaves its stub wire; deleting wires by coordinate guessing multiplies `unconnected_wire_endpoint` debris — never sweep blind, it gets worse.
- **A wire passing through a pin's position MID-SEGMENT connects to that pin** (pin-on-wire rule). A straight switch→diode junction wire passes over the diode's other pin → diode shorted/bypassed. Route junctions as detours (down 5.08mm — below label-stub depth — across, up).
**Ground truth is the NETLIST, not ERC:** count members per net, and for key matrices assert per-key `net(SWk.2) == net(Dk.2)` and that it is NOT the row net.

## Trap 3 — bare custom footprints
`place_component` with a custom-library footprint writes no Reference property → IPC sync can't match it and will duplicate. Inject `(property "Reference" ...)` into the .kicad_pcb block (python patch), then re-parse via `kicad-cli pcb export pdf` to validate the file.

## Mechanical verification beats renders
Parse the .kicad_pcb directly (python regex on footprint/at/Reference) and assert exact expected coordinates per component — stronger than pixel checks (per the CAD-arbitration lesson). Renders: `kicad-cli pcb export pdf -o out.pdf --layers F.Cu,F.SilkS,Edge.Cuts board.kicad_pcb` (**--layers is required**), then `sips -s format png`.

## Design conventions that worked
- Case→KiCad map `kx = case_x, ky = case_max_y − case_y`; keep ONE linear map for outline, holes, grid, connectors.
- Matrix from firmware overlay (kscan col2row = cols driven, stripe/cathode at ROW); number keys row-major `SWk = 1 + r*4 + c`.
- Bent-pin EC11: custom 4-pad SMD footprint (A/B + 2×C, pads 3×2mm) — precision uncritical for hand-bent pins.
- Controller-agnostic: socketed 2×8 2.54 header, full pinout table on F.SilkS (pins 1-8 rows/cols, 9-12 enc, 13-14 i²c, 15-16 power).
- Mounting: Ø3.5 holes on the case's insert posts (the void16 case was pre-designed for a PCB at plate-plane−4.5mm, tilted 6° with the plate).
- 2-layer matrix routing plan: rows horizontal on F.Cu between switch columns, cols vertical on B.Cu through the diode row, GND pour on B.Cu.
