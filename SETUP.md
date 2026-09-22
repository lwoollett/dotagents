# Setup & Bootstrap

How to get this directory working on a new machine. For what `~/.agents` actually is and
why it's laid out this way, see [README.md](./README.md) — this page is just the mechanics.

The short version: clone the repo to `~/.agents`, then recreate the vendor symlinks
described below. Every command is idempotent — `ln -sfn` replaces an existing link without
complaining, and `mkdir -p` on a path that already exists does nothing — so it's safe to
re-run anything here whenever you've lost track of what you've already done.

## Back up first

`ln -sfn` will happily clobber a real (non-symlink) vendor file without so much as a
warning, so take a snapshot of anything you're about to shadow before you start:

```bash
ts=$(date +%Y%m%d-%H%M%S)
backup=~/.config-backups/agents-consolidate-$ts
mkdir -p "$backup"
for p in "$HOME/.omp/agent" "$HOME/.pi/agent" "$HOME/.config/opencode"; do
  [ -e "$p" ] && [ ! -L "$p" ] && cp -a "$p" "$backup/"
done
```

## OMP

OMP reads its configuration from `~/.omp/agent/`, so the real files live here and get
linked into place:

```bash
mkdir -p "$HOME/.agents/config/omp" "$HOME/.omp/agent"
ln -sfn "$HOME/.agents/config/omp/config.yml"  "$HOME/.omp/agent/config.yml"
ln -sfn "$HOME/.agents/config/omp/models.yml"  "$HOME/.omp/agent/models.yml"
ln -sfn "$HOME/.agents/config/omp/.env"        "$HOME/.omp/agent/.env"
```

One gotcha: if `config.yml`, `models.yml`, or `.env` is still a real file from an older
install, `ln -sfn` will replace it silently — move its content into
`~/.agents/config/omp/` first.

Home machines repoint at the `_home` variants instead — GLM model roles plus the Z.ai
MCP servers:

```bash
ln -sfn "$HOME/.agents/config/omp/config_home.yml" "$HOME/.omp/agent/config.yml"
ln -sfn "$HOME/.agents/config/omp/models_home.yml" "$HOME/.omp/agent/models.yml"   # if linked at all
ln -sfn "$HOME/.agents/config/omp/mcp_home.json"    "$HOME/.omp/agent/mcp.json"
```


## OMP managed skills

`~/.omp/agent/managed-skills` is a single symlink to the canonical `skills/` folder, so
skills minted by OMP's learn/manage_skill tooling are born inside this repo — adoption
is just `git add` + `git commit`. (Like memories, this is a move, not a copy: two live
copies of a skill is how you end up editing the wrong one.)

```bash
mkdir -p "$HOME/.agents/skills" "$HOME/.omp/agent"
ln -sfn "$HOME/.agents/skills" "$HOME/.omp/agent/managed-skills"
```

If `managed-skills` already exists as a real directory on a new machine, move its
contents into `~/.agents/skills/` first, then link.

## OMP memories

If `~/.omp/agent/memories` already exists as a real directory on the new machine, move its
content into `~/.agents/memories/` first — per ProtocolMemories this is a move, not a
copy, because two live copies of your memories is a good way to end up editing the wrong
one. Then link:

```bash
mkdir -p "$HOME/.agents/memories"
ln -sfn "$HOME/.agents/memories" "$HOME/.omp/agent/memories"
```

## OpenCode

OpenCode, same story, different vendor directory (`~/.config/opencode/`):

```bash
mkdir -p "$HOME/.agents/config/opencode" "$HOME/.config/opencode"
for f in opencode.json oh-my-openagent.json tui.json lsp-install-decisions.json; do
  ln -sfn "$HOME/.agents/config/opencode/$f" "$HOME/.config/opencode/$f"
done
```

Any `package.json` / `node_modules` under `~/.config/opencode` belong to OpenCode's plugin
loader, not this repo — install them there natively and leave them alone.

## Pi

Pi reads everything from its agent directory (`~/.pi/agent`, also settable via
`PI_CODING_AGENT_DIR`), so the whole directory is vendored with a single link — no
per-file split like OMP/OpenCode. `settings.json` (and anything `pi install` registers)
is committable; `auth.json`, `sessions/`, `bin/`, and `models-store.json` are runtime
state and gitignored (see `.gitignore`).

```bash
mkdir -p "$HOME/.agents/config/pi" "$HOME/.agents/skills" "$HOME/.pi"
ln -sfn "$HOME/.agents/config/pi" "$HOME/.pi/agent"
ln -sfn "$HOME/.agents/skills"     "$HOME/.agents/config/pi/skills"
```

Gotcha: if `~/.pi/agent` still exists as a real directory, `ln -sfn` nests the link
*inside* it instead of replacing it — move the contents into `~/.agents/config/pi/` and
`rmdir` it first (which is why it's in the backup loop above). Skills are shared with
OMP: `config/pi/skills` points at the canonical `skills/` folder, so both harnesses
discover the same SKILL.md set.

MCP follows the omp home-variant pattern: pi-mcp-adapter reads the root `mcp.json`
baseline *and* `~/.pi/agent/mcp.json` (its "Pi global override", merged last), so home
machines link the full Z.ai set the same way OMP does:

```bash
ln -sfn "$HOME/.agents/config/omp/mcp_home.json" "$HOME/.pi/agent/mcp.json"
```

`pi install` drops vendor state under `config/pi/npm/` and `config/pi/git/` — each gets a
pi-generated `.gitignore` (`*` + `!.gitignore`), so commit those two files and the
node_modules / clones inside stay out of the repo. On a fresh machine, re-run
`pi install` for each `packages[]` entry in `settings.json` to repopulate them.

### Locally-developed extensions

`config/pi/extensions/<name>/` is pi's global extension dir (auto-discovered through the
`~/.pi/agent` symlink — no settings.json entry needed). `pi-autolearn` lives there: a
port of omp's Auto-Learn — `learn` + `manage_skill` tools writing the same omp formats
into the shared `skills/` and `memories/` trees, plus an auto-capture turn (interactive
sessions only) after runs with ≥5 tool calls. Its config is `config/pi/autolearn.json`
(`enabled`, `autoContinue`, `minToolCalls`; env overrides `PI_AUTOLEARN_CONFIG`,
`PI_AUTOLEARN_SKILLS_DIR`, `PI_AUTOLEARN_MEMORIES_DIR`). Regression test:
`cd config/pi/extensions/pi-autolearn && bun run test.ts` (the `node_modules/` symlinks
there are dev-only test plumbing — gitignored, not needed at runtime; pi injects the
imports itself).

## MCP tool servers

The MCP servers themselves are declared once in the top-level `mcp.json`, and almost all
of them are invoked with `npx -y <package>`, so OMP and OpenCode download and run them on
demand. No global install (`npm i -g`), no separate setup script, nothing to babysit —
you just need Node.js + npm on your `PATH` and outbound network access the first time
each server runs.

There are two variants: the root `mcp.json` is the portable/work baseline (no Z.ai
servers), while `config/omp/mcp_home.json` is the home variant with the full set
(`zai-mcp-server`, `web-reader`, `web-search-prime`, `zread`). Home machines symlink the
variant into `~/.omp/agent/mcp.json` (see the OMP section above); work machines link the
root file or nothing at all. The table below covers the union of both variants.

| Server | Invocation | Transport | Required env var | Notes |
| --- | --- | --- | --- | --- |
| `ado` | `npx -y @azure-devops/mcp` | stdio | `PERSONAL_ACCESS_TOKEN` | Also honours `NODE_USE_ENV_PROXY=1` if you are behind a proxy. |
| `context7` | `npx -y @upstash/context7-mcp@latest` | stdio | — | No auth. |
| `github` | `npx -y @modelcontextprotocol/server-github` | stdio | `GITHUB_TOKEN`* | *Not declared in `mcp.json`; the server reads it from the inherited shell env. Export it in your profile. |
| `playwright` | `npx -y @playwright/mcp@latest` | stdio | — | Browser automation. |
| `zai-mcp-server` | `npx -y @z_ai/mcp-server` | stdio | `Z_AI_API_KEY` | Also sets `Z_AI_MODE=ZAI` internally. |
| `web-reader` | `https://api.z.ai/api/mcp/web_reader/mcp` | streamable-http | `Z_AI_API_KEY` | Remote; no local install. |
| `web-search-prime` | `https://api.z.ai/api/mcp/web_search_prime/mcp` | streamable-http | `Z_AI_API_KEY` | Remote; no local install. |
| `zread` | `https://api.z.ai/api/mcp/zread/mcp` | streamable-http | `Z_AI_API_KEY` | Remote; no local install. |

Set `PERSONAL_ACCESS_TOKEN`, `Z_AI_API_KEY`, and `GITHUB_TOKEN` in your shell profile (or
in `config/omp/.env` if it's OMP that needs them). If a server refuses to start, open a
scratch OMP session and read the MCP logs — `npx` download failures always surface there.

## Verify

Once the links are in place, check that every vendor path is a symlink pointing back into
`~/.agents`:

```bash
ls -l "$HOME/.omp/agent/config.yml" "$HOME/.omp/agent/models.yml" "$HOME/.omp/agent/.env" \
      "$HOME/.omp/agent/memories" \
      "$HOME/.omp/agent/managed-skills" \
      "$HOME/.omp/agent/mcp.json" \
      "$HOME/.pi/agent" \
      "$HOME/.config/opencode/opencode.json" "$HOME/.config/opencode/oh-my-openagent.json" \
      "$HOME/.config/opencode/tui.json" "$HOME/.config/opencode/lsp-install-decisions.json"
```

…and that nothing is dangling — this prints `OK` only if there are no broken links:

```bash
broken=$(find "$HOME/.agents" "$HOME/.omp/agent" "$HOME/.pi" "$HOME/.config/opencode" \
  -maxdepth 3 -xtype l 2>/dev/null); [ -z "$broken" ] && echo OK || printf '%s\n' "$broken"
```

Finally, smoke-test the tools: `omp` should start and list your models, `opencode`
should load its config without complaining, and `pi list` should report its extension
list (empty is fine — it proves settings.json parsed through the symlink).

## Environment Variables

The portable config files (`mcp.json`, `models.yml`) and some skills reference secrets by
environment-variable name rather than by value — that's what keeps them committable. Set
the variables themselves in your shell environment, and if you want OMP to expand the
`${ENV_VAR}` references in `mcp.json` and `models.yml` at runtime, also add them to
`config/omp/.env` (the file OMP reads).

There's a template for the required variables in `.env.example` — copy it to `.env` and
fill in real values (`.env` is gitignored):

```bash
cp .env.example .env   # then edit .env with your own credentials
```

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PERSONAL_ACCESS_TOKEN` | `mcp.json` → "ado" server (omp via `config/omp/.env`; pi via shell env — `pi-mcp-adapter` reads `~/.agents/mcp.json` directly) | Azure DevOps PAT for repo / work-item / PR access |
| `Z_AI_API_KEY` | `mcp.json` → zai-mcp-server, web-reader, web-search-prime, zread | Z.ai (Zhipu) API key for the web-search/reader MCP tools |
| `ZAI_API_KEY` | pi → `zai` provider | Same Z.ai key; pi's env-var name omits the underscore. `~/.secrets` aliases it from `Z_AI_API_KEY` |
| `MICROSOFT_FOUNDRY_API_KEY` | `models.yml` → microsoft-foundry provider | Azure AI Foundry key for hosted models |
| `NVIDIA_API_KEY` | `skills/nvidia-image-gen/` | NVIDIA API key for image generation (must start with `nvapi-`; get at https://build.nvidia.com) |
| `NODE_USE_ENV_PROXY` | `mcp.json` → "ado" env | Optional; set to `1` to make the ado server honour proxy env vars |

None of these are needed for the rest of the repo to work — only the tools and skills that
consume them care.

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
