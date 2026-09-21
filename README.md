# ~/.agents — portable agent configuration

Agents folder. Sadly most harnesses don't use this yet, so symlinks are needed. See [SETUP.md](./SETUP.md).

Currently using OMP (Oh-My-PiAgent), which is based on PI.
OpenCode config still exists here because I'm lazy and haven't fully uninstalled it yet.
My reason for switching from OpenCode to Oh-My-Pi is unknown even to me.

My `~/.agents` attempts to mimic the [.agents Protocol](https://dotagentsprotocol.com/), but again, half the harnesses don't support it for some reason.

Most notable is the [Skills Folder](./skills/). It started as Azure DevOps, commits, image
generation using NVIDIA's generous free tier, and screenshots; since then it's grown
D&D module extraction, ZMK keyboard-firmware bring-up, Dungeondraft modding, and
branch-review workflows. It's also OMP's live managed-skills directory now:
`~/.omp/agent/managed-skills` symlinks here, so skills the harness mints are born in
the repo and adopting one is just a git commit. Impeccable is also in there, but
that's managed by git and not my framework.

Harness configs live in config.

> **Setting up on a new machine?** See **[SETUP.md](./SETUP.md)** for the bootstrap steps,
> vendor symlinks, MCP server prerequisites, and environment-variable configuration.

## Layout

```text
~/.agents/
├── mcp.json            # portable MCP tool servers (protocol format)
├── skills/             # canonical skills: skills/<name>/SKILL.md
│                       #   (also OMP's managed-skills: ~/.omp/agent/managed-skills → here)
├── agents/             # canonical sub-agent profiles: agents/<id>/agent.md
├── memories/           # canonical memories (tracked as files; private — see .gitignore)
├── config/
│   ├── omp/            # OMP-native config: config.yml, models.yml, .env, mcp_home.json (home MCP variant)
│   └── opencode/       # OpenCode-native config: opencode.json, oh-my-openagent.json, tui.json, …
└── .skill-lock.json    # skill installer lockfile (tracked)
```

## Secrets

- `config/omp/.env` and `config/opencode/opencode.json` contain credentials and are
  **gitignored** — keep the real values out of git; a fresh machine needs them recreated
  by hand or from your password manager.
- `.gitignore` also covers `.env*`, `*.bak*`, temp files, `*.db*` (WAL/SHM), logs, caches,
  and session directories wherever they appear.
- The portable protocol files (`mcp.json`, `skills/`, `agents/`) are
  expected to stay sanitized: reference credentials by environment-variable name, never by
  value, so they remain committable. `memories/` holds private per-project notes and is
  gitignored by default — track it deliberately only if you want them in this repo.

A template for required environment variables lives in `.env.example`.
