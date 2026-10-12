---
name: "fvtt-content-ops"
description: "Build and review Foundry VTT world content for BrokenWorld via the foundry MCP — SWADE conversion, bulk actor/journal/scene/map import"
---

# Foundry VTT content ops for fvtt.lwlt.me (rackpi2)

Use when building/importing content for the BrokenWorld campaign on Luke's Foundry VTT instance, or reviewing the world via the foundry MCP.

## Project state docs (read these first)

- **`~/Documents/lwlt/TTRPGs/BrokenWorld/TODO.md`** — the live punch list (open issues, cleanups, session-1 readiness, parked items).
- **`~/Documents/lwlt/TTRPGs/BrokenWorld/Foundry Progress Log.md`** — chronological build log.
- Update both when completing/adding work items.

## Setup facts

- Instance: felddy/foundryvtt docker on rackpi2, https://fvtt.lwlt.me (public), core 14.369, license bound to container hostname `fvtt`.
- World: dir `broken-world` (runtime id sanitized to `brokenworld`), DB at `/srv/fvtt/data/Data/worlds/brokenworld/data/` (nested `Data/Data`).
- **Asset base = sanitized runtime dir**: upload to `/srv/fvtt/data/Data/worlds/brokenworld/Data/`, reference as `worlds/brokenworld/Data/maps/<file>`. Legacy `worlds/broken-world/` does NOT serve. Verify: `curl -sk --resolve fvtt.lwlt.me:443:192.168.0.189 https://fvtt.lwlt.me/<path>` → 200.
- MCP: `foundry` in pi runs the **lwoollett fork** (`bun ~/repos/foundryvtt-mcp/dist/index.js`): v14.369 Origin fix + actor/folder/scene CRUD (commits 953199d, 27da5a2, 81e4020). User `MCP` (Assistant role). `FOUNDRY_WRITE_ENABLED=true`.
- World must be ACTIVE (`/api/status`). After restarts may need manual UI launch.

## Portraits pipeline (in progress)

- **NO ComfyUI on the home network** (standing rule) — generation happens on Luke's work rig (4× RTX PRO 6000).
- `~/Documents/lwlt/TTRPGs/BrokenWorld/Portraits/` holds: `portraits-pack.jsonl` (204 prompts: 2e-ink style bible from ImageGeneration.md + per-creature Visual Description + posture cue; slugged `file` names match actor names), `comfy-batch.py` (stdlib ComfyUI API driver, resumable, skips existing `out/` files), `README-portraits.md` (run sheet).
- When `Portraits/out/*.png` returns from the rig: set each actor `img` + `prototypeToken.texture.src` = `worlds/brokenworld/Data/portraits/<file>` (upload first), scripted via the MCP fork (update_actor_attributes patches system + prototypeToken dot-paths).

## v14 scene gotchas

- **Scenes REQUIRE ≥1 Level + `initialLevel` id** or client WebGL crashes in `_determineInitialLevel`. Fork's `create_scene` auto-includes (client-generated `_id`). Repair existing: two socket updates.
- **modifyDocument payload**: `{type, action, operation:{broadcast:true, pack:null, modifiedTime, updates|ids|data}}` — wrong shape = silent timeout.
- Raw-socket fixer pattern: GET /join cookie → POST /join (Origin header) → socket.io ws + cookie → `socket.timeout(20000).emit('modifyDocument', request, cb)`.
- Map backgrounds were still gray client-side after the img fix (2026-10-13) — asset serves 200, scenes updated; suspect browser cache. Next: hard refresh / Scene Config re-save; then vision-check a screenshot.

## Vision verification (session model can't see images)

- No `subagent` tool? Call GLM directly: z.ai coding endpoint, `image_url` data-URI + ≤6-point checklist, **max_tokens ≥ 2000** (reasoning burns small budgets → empty content looks like failure).
- Luke's Desktop screenshots: glob-copy (quoted literal paths with backslashes fail).

## World DB archaeology (LevelDB)

- Records: `!<collection>!<16-char id><ctrl bytes \x03>{json}` — keys sometimes plural (`!scenes!`, `!journal!`); allow `[\x00-\x1f]*` before `{`.
- Journal records: `{"name","pages":["<pageId>"],"folder","_id"}`; page records separate (`_id` at END).
- strings/python on `*.log`; tombstones overcount; `_id` often after the body — extract positionally.
- Foundry bundle is inside the container only (`docker exec fvtt sh -c "grep ..."`). HEXODDR=2 (pointy-top odd-r).

## SWADE actor data model (system 6.0.4)

- `system.attributes.{attr}.die.{sides,modifier}` (+ `smarts.animal:true`), `system.pace.default`, `system.stats.toughness.{value,armor}`, `system.stats.parry.{value,shield}`, `system.stats.size`, `system.wounds.{value,max}`, `system.wildcard`, `system.details.biography.value/notes`.
- Pin derived stats: `details.autoCalcParry:false` + `autoCalcToughness:false`.
- Embedded items: skill `{type:"skill",system:{attribute,die:{sides,modifier:0},"wild-die":{sides:6}}}`, ability `{type:"ability",system:{description}}`.
- Socket creates store `system` verbatim; defaults materialize on read.

## Bulk import playbook (fork scripts)

1. `scripts/mcp-call.ts` — single tool call over stdio (JSON-RPC init + ~6s auth wait).
2. `scripts/bulk-import.ts payload.json` — folders → journals → scenes → actors; `--only=`, `--dry`; ID regex `/IDs?:\*?\*?\s*([a-zA-Z0-9]{16})/g`; journal success needs journalId AND pageId; scene notes resolve by name or direct `journalId`+`pageId`.
3. Test-batch → inspect → delete → full run. No idempotency — re-runs duplicate.
4. Verify via fresh-connection search or LevelDB — `refresh_world_data` times out at scale.
5. **Patch discipline**: `python str.replace` silently no-ops on no-match — grep-verify; `bun run build` (strict tsc) must pass.

## Mapping pipeline (hexmaps)

- Hex ids are **CCRR** (col,row). Starting region = cols 01–03 × rows 05–08. 100 hex docs → 66 unique cells (0306 crash-site beats "Buried Spire" — flagged).
- PIL pointy-top odd-r; scene `grid:{type:2,size:round(w),distance:6,units:"mi"}`; notes absolute-positioned at drawn centers.
- md→HTML converter pattern in `/tmp/hex-journals-payload.py`.

## Content state

- ✅ 204 bestiary NPCs (10 biome folders); 121 journals; 2 scenes (world 66 pins, region 9), Ground levels + initialLevel, imgs → `worlds/brokenworld/Data/maps/` (serving 200; client render unconfirmed).
- ⚠️ Cleanup: duplicate "Hex Map Design" journal; duplicate "Ground" levels; 0306 contradiction; grid alignment unverified; fog unconfigured.
- ⏳ Queued: portraits set-on-actors (awaiting rig output); Silken Chain battle scene; 4 level-0 PC actors; Starting Area Bestiary actors; backups; upstream PR; auto-launch test.
- 🚫 Exclude: LitRPG/, __pycache__/, Hexes/{brace-artifact}/, ._* AppleDouble files.

## 2e→SWADE mapping (bestiary)

THAC0 19+/–→Fighting d4 … ≤12→d12 (none if Attacks:None); HD→Str/Vig d6..d12; HP 40+/80+→+1/+2 Size; AC ≤0→armor +4 … ≥7→+0; Size T→-2 S→-1 M→0 L→+2 H→+3 G→+4; Move 6/9/12/15/18+→Pace 5/6/8/10/12 (`Fl`→Flight); Morale Fearless→Spirit d10+Fearless, ≤7→d4; Damage XdY→Str+dN ability text (raw dice preserved).
