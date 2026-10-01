# Some installed items on my raw Pi install

https://pi.dev/packages/pi-web-access
https://pi.dev/packages/pi-subagents
https://pi.dev/packages/@juicesharp/rpiv-ask-user-question
https://pi.dev/packages/pi-lens
https://pi.dev/packages/@narumitw/pi-btw
https://pi.dev/packages/pi-subagent-monitor

Memory Management:
https://github.com/sting8k/pi-vcc

## Native MCP + codemode (2026-10-02)

- pi ≥ 1.0 has native MCP: `config/pi/mcp.json`, native format (`command/args/env` for
  stdio, `url/headers` for HTTP, `${VAR}` env refs, optional `description`/`exposure`).
  `pi-mcp-adapter` was removed (`pi remove npm:pi-mcp-adapter`) — an extension that
  registers `/mcp` *replaces* the builtin, so it had to go before `mcp.json` did
  anything.
- Tool naming is `mcp__<server>__<tool>`; default exposure is `codemode`, so tools are
  not declared to the model — codemode scripts call e.g.
  `tools.mcp__fusion360__execute_code`, and `searchTools()` finds the rest. A server
  whose `${VAR}` is unset is skipped with a clear error while the others connect, which
  is what makes tracking the full home set in git safe.
- Codemode is pinned on via `"defaultTools": ["+codemode"]` in `settings.json` —
  worth it even without MCP (parallel tool calls, output filtering, classifier + image
  models through the `models` global).

## Subagent monitoring (2026-09-23)

- pi-subagents ships its own monitoring UI: FleetView (persistent panel under the
  editor) and `/subagents-fleet` (s=steer, D=stop, x=tool details);
  `/subagents-doctor` diagnoses setup. Its optional config file would be
  `config/pi/extensions/subagent/config.json` — deliberately absent so far, so
  `fleetViewPlacement`/`asyncWidget`/`inlineToolDisplay` and friends run on defaults;
  create and commit it only if we customize them.
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