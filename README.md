# ~/.agents — portable agent configuration

Agents folder. Sadly most harnesses don't use this yet, so symlinks are needed. See [SETUP.md](./SETUP.md).

Pure [Pi](https://pi.dev) everywhere. This repo is my Pi config plus the
portable agents layer.

My `~/.agents` attempts to mimic the [.agents Protocol](https://dotagentsprotocol.com/), but again, half the harnesses don't support it for some reason.

Most notable is the [Skills Folder](./skills/). It started as Azure DevOps, commits, image
generation using NVIDIA's generous free tier, and screenshots; since then it's grown
D&D module extraction, ZMK keyboard-firmware bring-up, Dungeondraft modding, and
branch-review workflows. Pi's learn/manage_skill tooling mints skills straight into
this repo (`config/pi/skills` → `skills/`), so a skill is born tracked and adopting
one is just a git commit. Impeccable is also in there, but
that's managed by git and not my framework.

Harness config lives in config.

> **Setting up on a new machine?** See **[SETUP.md](./SETUP.md)** for the bootstrap steps,
> vendor symlinks, MCP server prerequisites, and environment-variable configuration.

## Layout

```text
~/.agents/
├── mcp.json            # portable MCP tool servers (protocol format; mirror of config/pi/mcp.json)
├── skills/             # canonical skills: skills/<name>/SKILL.md
│                       #   (also pi's live skills dir: config/pi/skills → here)
├── agents/             # canonical sub-agent profiles: agents/<id>/agent.md
│                       #   (also live for pi: pi-subagents scans this folder via
│                       #    subagents.agentScanDirs in config/pi/settings.json —
│                       #    pi-format files like agents/visual.md)
├── memories/           # canonical memories (tracked as files; private — see .gitignore)
├── config/
│   ├── pi/             # Pi config dir, vendored whole (~/.pi/agent → here): settings.json, mcp.json (native MCP), skills → ../skills
│   ├── pi/extensions/  # locally-developed pi extensions (pi-autolearn: learn + manage_skill)
│   └── git/            # git identity: gitconfig ([user] email)
└── .skill-lock.json    # skill installer lockfile (tracked)
```

## Secrets

- Credentials live in the shell environment; the tracked configs reference them by
  `${ENV_VAR}` name only, which is what keeps them committable. A fresh machine needs
  the real values recreated by hand or from your password manager (see `.env.example`
  for the list).
- `.gitignore` also covers `.env*`, `*.bak*`, temp files, `*.db*` (WAL/SHM), logs, caches,
  and session directories wherever they appear.
- The portable protocol files (`mcp.json`, `skills/`, `agents/`) are
  expected to stay sanitized: reference credentials by environment-variable name, never by
  value, so they remain committable. `memories/` holds private per-project notes and is
  gitignored by default — track it deliberately only if you want them in this repo.
