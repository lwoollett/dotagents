# Setup & Bootstrap

How to get this directory working on a new machine. For what `~/.agents` actually is and
why it's laid out this way, see [README.md](./README.md) — this page is just the mechanics.

The short version: clone the repo to `~/.agents`, then recreate the vendor symlinks
described below. Every command is idempotent — `ln -sfn` replaces an existing link without
complaining, and `mkdir -p` on a path that already exists does nothing — so it's safe to
re-run anything here whenever you've lost track of what you've already done.

Pi is the only harness; everything
under `config/` other than `git/` is Pi config.

## Back up first

`ln -sfn` will happily clobber a real (non-symlink) vendor file without so much as a
warning, so take a snapshot of anything you're about to shadow before you start:

```bash
ts=$(date +%Y%m%d-%H%M%S)
backup=~/.config-backups/agents-consolidate-$ts
mkdir -p "$backup"
for p in "$HOME/.pi/agent"; do
  [ -e "$p" ] && [ ! -L "$p" ] && cp -a "$p" "$backup/"
done
```

## Pi

Pi reads everything from its agent directory (`~/.pi/agent`, also settable via
`PI_CODING_AGENT_DIR`), so the whole directory is vendored with a single link.
`settings.json` (and anything `pi install` registers) is committable; `auth.json`,
`sessions/`, `bin/`, and `models-store.json` are runtime state and gitignored
(see `.gitignore`).

```bash
mkdir -p "$HOME/.agents/config/pi" "$HOME/.agents/skills" "$HOME/.pi"
ln -sfn "$HOME/.agents/config/pi" "$HOME/.pi/agent"
ln -sfn "$HOME/.agents/skills"     "$HOME/.agents/config/pi/skills"
```

Gotcha: if `~/.pi/agent` still exists as a real directory, `ln -sfn` nests the link
*inside* it instead of replacing it — move the contents into `~/.agents/config/pi/` and
`rmdir` it first (which is why it's in the backup loop above). `config/pi/skills` points
at the canonical `skills/` folder, so skills minted by pi's learn/manage_skill tooling
are born inside the repo — adoption is just `git add` + `git commit`. (Like memories,
this is a move, not a copy: two live copies of a skill is how you end up editing the
wrong one.)

Sub-agent profiles are shared the same way: `config/pi/settings.json` sets
`subagents.agentScanDirs: ["~/.agents/agents"]`, so pi-subagents discovers
agents dropped in the canonical `agents/` folder. Pi wants flat frontmatter files
(`agents/visual.md`), not the protocol's `agents/<id>/agent.md` shape — only files
pi can parse are picked up, and fixed dirs (`~/.pi/agent/agents/`, project
`.pi/agents/`) still win name collisions over scan-root agents; builtins lose to
both.

MCP is native since pi 1.0 and reads `config/pi/mcp.json` straight through the
`~/.pi/agent` link — no extension involved. The tracked file carries the full server
set (Z.ai and all) with credentials as `${ENV_VAR}` references, so it stays committable;
there is deliberately no home/work variant swap, because the whole agent directory is
one symlink. A machine that lacks a key simply skips that server at startup (pi reports
`Failed to resolve … from environment variable` and connects the rest), so a fresh clone
works everywhere the baseline variables exist. The root `mcp.json` is a mirror of the
same server set in .agents-protocol format, kept for portability. `pi mcp list` checks
every connection from a shell, `/mcp` inside a session inspects, reconnects, signs in,
and toggles servers, and OAuth tokens (if ever used) land in `mcp-auth.json`, which is
gitignored.

Codemode is on by default: `"defaultTools": ["+codemode"]` in `settings.json` keeps the
codemode tool available even when no MCP server connects — handy for parallel tool
calls, filtering huge outputs before the model sees them, and the classifier/image
models. MCP tools use the default `codemode` exposure, so they are reached by writing a
script (`tools.mcp__<server>__<tool>`) instead of being declared to the model; give a
server `"exposure": "direct"` in `mcp.json` if you want its tools listed outright.

`pi install` drops vendor state under `config/pi/npm/` and `config/pi/git/` — each gets a
pi-generated `.gitignore` (`*` + `!.gitignore`), so commit those two files and the
node_modules / clones inside stay out of the repo. On a fresh machine, re-run
`pi install` for each `packages[]` entry in `settings.json` to repopulate them.

### Locally-developed extensions

`config/pi/extensions/<name>/` is pi's global extension dir (auto-discovered through the
`~/.pi/agent` symlink — no settings.json entry needed). `pi-autolearn` lives there:
`learn` + `manage_skill` tools writing markdown skills and memories into the shared
`skills/` and `memories/` trees, plus an auto-capture turn (interactive sessions only)
after runs with ≥5 tool calls. Its config is `config/pi/autolearn.json`
(`enabled`, `autoContinue`, `minToolCalls`; env overrides `PI_AUTOLEARN_CONFIG`,
`PI_AUTOLEARN_SKILLS_DIR`, `PI_AUTOLEARN_MEMORIES_DIR`). Regression test:
`cd config/pi/extensions/pi-autolearn && bun run test.ts` (the `node_modules/` symlinks
there are dev-only test plumbing — gitignored, not needed at runtime; pi injects the
imports itself).

## MCP tool servers

The MCP servers that actually run are declared in `config/pi/mcp.json` (pi's native
format, mirrored into the root protocol `mcp.json`), and almost all of them are invoked
with `npx -y <package>`, so pi downloads and runs them on demand. No global install
(`npm i -g`), no separate setup script, nothing to babysit — you just need Node.js + npm
on your `PATH` and outbound network access the first time each server runs.

| Server | Invocation | Transport | Required env var | Notes |
| --- | --- | --- | --- | --- |
| `ado` | `npx -y @azure-devops/mcp` | stdio | `PERSONAL_ACCESS_TOKEN` | Also honours `NODE_USE_ENV_PROXY=1` if you are behind a proxy. |
| `konnect` | `~/.local/bin/konnect` (local binary) | stdio | — | KiCad 10 schematic/PCB design via the IPC API; needs KiCad running with the KiCad API enabled (see the `kicad-konnect-pcb-design` skill). |
| `context7` | `npx -y @upstash/context7-mcp@latest` | stdio | — | No auth. |
| `fusion360` | `uvx --with mcp==1.26.0 fusion360-mcp-server --mode socket` | stdio | — | Needs the Fusion 360 MCP add-in listening on `localhost:9876` (see the `fusion360-mcp-cad-builds` skill). |
| `github` | `npx -y @modelcontextprotocol/server-github` | stdio | `GITHUB_TOKEN`* | *Not declared in `mcp.json`; the server reads it from the inherited shell env. Export it in your profile. |
| `godot` | `npx -y @coding-solo/godot-mcp` | stdio | — | `GODOT_PATH` in `config/pi/mcp.json` hard-codes the home-machine Godot.app path; adjust locally elsewhere. |
| `playwright` | `npx -y @playwright/mcp@latest` | stdio | — | Browser automation. |
| `zai-mcp-server` | `npx -y @z_ai/mcp-server` | stdio | `Z_AI_API_KEY` | Also sets `Z_AI_MODE=ZAI` internally. |
| `web-reader` | `https://api.z.ai/api/mcp/web_reader/mcp` | streamable-http | `Z_AI_API_KEY` | Remote; no local install. |
| `web-search-prime` | `https://api.z.ai/api/mcp/web_search_prime/mcp` | streamable-http | `Z_AI_API_KEY` | Remote; no local install. |
| `zread` | `https://api.z.ai/api/mcp/zread/mcp` | streamable-http | `Z_AI_API_KEY` | Remote; no local install. |

Set `PERSONAL_ACCESS_TOKEN`, `Z_AI_API_KEY`, and `GITHUB_TOKEN` in your shell profile —
pi expands the `${ENV_VAR}` references at startup from the process environment. If a
server refuses to start, run `pi mcp list` from a shell or open `/mcp` in a session —
`npx` download failures always surface there.

## Verify

Once the links are in place, check that the vendor path is a symlink pointing back into
`~/.agents`:

```bash
ls -l "$HOME/.pi/agent"
```

…and that nothing is dangling — this prints `OK` only if there are no broken links:

```bash
broken=$(find "$HOME/.agents" "$HOME/.pi" -maxdepth 3 -xtype l 2>/dev/null); \
  [ -z "$broken" ] && echo OK || printf '%s\n' "$broken"
```

Finally, smoke-test the tools: `pi list` should report its extension list (empty is
fine — it proves settings.json parsed through the symlink), and `pi mcp list` should
connect every server whose env vars are set.

## Environment Variables

The config files (`mcp.json`, `config/pi/mcp.json`) and some skills reference secrets by
environment-variable name rather than by value — that's what keeps them committable. Pi
expands the `${ENV_VAR}` references at runtime from the process environment, so set the
variables in your shell profile.

There's a template for the required variables in `.env.example` — it's documentation, not
something anything auto-loads; copy it to `.env` (gitignored) if you want a local
scratchpad:

```bash
cp .env.example .env   # then edit .env with your own credentials
```

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PERSONAL_ACCESS_TOKEN` | `mcp.json` → "ado" server | Azure DevOps PAT for repo / work-item / PR access |
| `Z_AI_API_KEY` | `mcp.json` → zai-mcp-server, web-reader, web-search-prime, zread | Z.ai (Zhipu) API key for the web-search/reader MCP tools |
| `ZAI_API_KEY` | pi → `zai` provider | Same Z.ai key; pi's env-var name omits the underscore. `~/.secrets` aliases it from `Z_AI_API_KEY` |
| `NVIDIA_API_KEY` | `skills/nvidia-image-gen/` | NVIDIA API key for image generation (must start with `nvapi-`; get at https://build.nvidia.com) |
| `NODE_USE_ENV_PROXY` | `mcp.json` → "ado" env | Optional; set to `1` to make the ado server honour proxy env vars |

None of these are needed for the rest of the repo to work — only the tools and skills that
consume them care.

## Secrets

- Real credentials only ever live in the shell environment (or a gitignored `.env`);
  every tracked file references them by `${ENV_VAR}` name, never by value.
- `.gitignore` also covers `.env*`, `*.bak*`, temp files, `*.db*` (WAL/SHM), logs, caches,
  and session directories wherever they appear.
- The portable protocol files (`mcp.json`, `skills/`, `agents/`) are
  expected to stay sanitized: reference credentials by environment-variable name, never by
  value, so they remain committable. `memories/` holds private per-project notes and is
  gitignored by default — track it deliberately only if you want them in this repo.
