# Some installed items on my raw Pi install

https://pi.dev/packages/pi-mcp-adapter
https://pi.dev/packages/pi-web-access
https://pi.dev/packages/pi-subagents
https://pi.dev/packages/@juicesharp/rpiv-ask-user-question
https://pi.dev/packages/pi-lens
https://pi.dev/packages/@narumitw/pi-btw
https://pi.dev/packages/pi-subagent-monitor

Memory Management:
https://github.com/sting8k/pi-vcc

## Subagent monitoring (2026-09-23)

- pi-subagents ships its own monitoring UI: FleetView (persistent panel under the
  editor; `fleetViewPlacement`, `asyncWidget`, `inlineToolDisplay` live in
  `config/pi/extensions/subagent/config.json`) and `/subagents-fleet` (s=steer,
  D=stop, x=tool details). `/subagents-doctor` diagnoses setup.
- pi-subagent-monitor read a *different* ecosystem's SQLite history
  (`~/.local/share/pi/subagents/*.sqlite`, written by @henryqw-style generators).
  nicobailon pi-subagents writes JSONL only, so the panel stayed empty here —
  removed 2026-09-28 (`pi remove npm:pi-subagent-monitor`).
- Its list-view features live on inside atelier: `config/pi/extensions/atelier-subagents/`
  polls pi-subagents RPC v1 (`status`) every second and publishes agent, elapsed,
  tokens, and goals to atelier's public sidebar-panel protocol (channel
  `pi-atelier:sidebar-panels`). Panel id `subagents:fleet`, enabled in
  `config/pi/pi-atelier.json` (sidebarPanelLayout); verify with
  `bun run config/pi/extensions/atelier-subagents/test.ts`.

## Custom agents

- `~/.agents/agents` is a pi-subagents scan root (`subagents.agentScanDirs` in
  `config/pi/settings.json`). First agent: `visual.md` — vision-first
  image/screenshot inspection on `glm-5.3-flash` (zai), tools read+write;
  per-run fallback model `glm-4.6v` (zai's dedicated vision line).
- zai catalog: `glm-4.6v`, `glm-5.3`, `glm-5.3-flash`, `glm-5.3-highspeed`.
- Usable builtins: scout, researcher, evidence-auditor, worker, reviewer,
  oracle, delegate. The CLI-runner profiles (claude-code/codex/cursor ±writer)
  are dead weight — those CLIs are not installed.