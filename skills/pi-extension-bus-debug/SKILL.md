---
name: "pi-extension-bus-debug"
description: "Verify/debug pi extensions that communicate over the pi event bus (e.g. atelier panels, subagents RPC bridges) when live TUI behavior contradicts the code"
---

# Debugging pi extension event-bus bridges

Use when a pi extension that talks over `pi.events` (e.g. bridging pi-subagents RPC into pi-atelier sidebar panels) silently shows nothing or stale data in the live TUI.

## Procedure

1. **Check timing first**: `ps -o lstart= -p <pid>` for the running pi vs `stat -f '%Sm'` on the extension files. Extensions load at startup; a session older than the extension won't have it.
2. **Static wire check**: grep the real package sources (not your mocks) for channel names and payload validation — `~/.pi/agent/npm/node_modules/<pkg>/src/` ships TypeScript. pi-atelier: `src/sidebar-panels.ts` (roles enum, caps, discover replay). pi-subagents: `src/extension/rpc.js`.
3. **Harness through the real loader** (no TUI needed):
   ```js
   import { createEventBus, discoverAndLoadExtensions } from "<pi-pkg>/dist/index.js";
   const bus = createEventBus();
   bus.on("pi-atelier:sidebar-panels", (d) => console.log(d));
   await discoverAndLoadExtensions([], cwd, agentDir, bus);
   // then simulate the other side: emit `subagents:rpc:v1:ready`, answer requests on `subagents:rpc:v1:request` with replies to `subagents:rpc:v1:reply:<requestId>`
   ```
4. **Subscription spy for live processes**: drop a temporary extension into `<agentDir>/extensions/bus-spy/` (manifest `{"pi":{"extensions":["./index.ts"]}}`) that SUBSCRIBES to the fixed channels and dynamically follows reply channels. Do NOT monkey-patch `emit` — each extension gets its own `pi.events` proxy, so a tap only sees the spy's own emits. Remove the spy when done.
5. **Print-mode repro with live data**: `cd /tmp && pi -p "<prompt that spawns an async subagent then runs bash sleep 15>"` — session_start fires in print mode, the 1s poller runs, and the spy log captures real RPC replies mid-run. Use `PI_CODING_AGENT_DIR=<tmp>` for full isolation, or the real agent dir for faithful repro.

## Reading the evidence

- Register events on `pi-atelier:sidebar-panels` with increasing `revision` = bridge alive and publishing.
- RPC request every second = poller started (session_start fired).
- `success:false` (`no_active_session`) reply or `fleet.entries:[]` while runs are active = pi-subagents state/session mismatch, not a bridge bug.
- pi exits at startup if any extension fails to load — a running pi means the extension loaded.
