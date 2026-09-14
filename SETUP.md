# Setup & Bootstrap

This document covers how to bootstrap the portable agent configuration on a new machine.

For an overview of what this directory is and how it is laid out, see [README.md](./README.md).

Clone this repository to `~/.agents`, then recreate the vendor links described below.
Every command is idempotent (`ln -sfn` replaces an existing link; `mkdir -p` is a no‑op
if the path already exists), so it is safe to re‑run at any time.

## 0. Back up first

Never overwrite a real (non‑symlink) vendor file blindly:

```bash
ts=$(date +%Y%m%d-%H%M%S)
backup=~/.config-backups/agents-consolidate-$ts
mkdir -p "$backup"
for p in "$HOME/.omp/agent" "$HOME/.config/opencode"; do
  [ -e "$p" ] && [ ! -L "$p" ] && cp -a "$p" "$backup/"
done
```

## 1. OMP

```bash
mkdir -p "$HOME/.agents/config/omp" "$HOME/.omp/agent"
ln -sfn "$HOME/.agents/config/omp/config.yml"  "$HOME/.omp/agent/config.yml"
ln -sfn "$HOME/.agents/config/omp/models.yml"  "$HOME/.omp/agent/models.yml"
ln -sfn "$HOME/.agents/config/omp/.env"        "$HOME/.omp/agent/.env"
```

If `~/.omp/agent/config.yml`, `models.yml`, or `.env` is still a real file from an older
install, move its content into `~/.agents/config/omp/` first — `ln -sfn` will replace it
without warning.

## 2. OMP managed skills

```bash
mkdir -p "$HOME/.omp/agent/managed-skills"
for s in askj-web-dead-code-review gb10-askj-stack-start \
         omp-add-openai-compatible-provider proxy-vs-network-triage spa-dead-code-scan \
         vllm-launch-flag-vetting; do
  ln -sfn "$HOME/.agents/skills/$s" "$HOME/.omp/agent/managed-skills/$s"
done
```

To adopt any other skill in `~/.agents/skills` into OMP, add its directory name to that list.

## 3. OMP memories

If `~/.omp/agent/memories` is a real directory on the new machine, move its content into
`~/.agents/memories/` first (per ProtocolMemories, this is a move, not a copy — keep one
copy), then link:

```bash
mkdir -p "$HOME/.agents/memories"
ln -sfn "$HOME/.agents/memories" "$HOME/.omp/agent/memories"
```

## 4. OpenCode

```bash
mkdir -p "$HOME/.agents/config/opencode" "$HOME/.config/opencode"
for f in opencode.json oh-my-openagent.json tui.json lsp-install-decisions.json; do
  ln -sfn "$HOME/.agents/config/opencode/$f" "$HOME/.config/opencode/$f"
done
```

`package.json` / `node_modules` under `~/.config/opencode` belong to OpenCode's plugin
loader — install them there natively; they are not part of this repo.

## 5. MCP tool servers

The MCP servers themselves are declared in the top‑level `mcp.json`. Almost all of
them are invoked with `npx -y <package>`, so OMP / OpenCode download and run them on
demand — you do **not** need a global install (`npm i -g`) or a separate setup script
(this repo has no `agent-browser`‑style install step).

Prerequisites for every server:

- Node.js + npm on your `PATH` (the `npx` invocations require them).
- Outbound network access on first run so `npx` can fetch the package.

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

Set the `PERSONAL_ACCESS_TOKEN`, `Z_AI_API_KEY`, and `GITHUB_TOKEN` values in your shell
profile (or in `config/omp/.env` for OMP). If a server fails to start, open a scratch
OMP session and check the MCP logs — `npx` download failures usually surface there.

## 6. Verify

```bash
# every vendor path must print a symlink pointing into ~/.agents
ls -l "$HOME/.omp/agent/config.yml" "$HOME/.omp/agent/models.yml" "$HOME/.omp/agent/.env" \
      "$HOME/.omp/agent/memories" \
      "$HOME/.omp/agent/managed-skills/"* \
      "$HOME/.config/opencode/opencode.json" "$HOME/.config/opencode/oh-my-openagent.json" \
      "$HOME/.config/opencode/tui.json" "$HOME/.config/opencode/lsp-install-decisions.json"

# all links must resolve (prints OK only if nothing is broken)
broken=$(find "$HOME/.agents" "$HOME/.omp/agent" "$HOME/.config/opencode" \
  -maxdepth 3 -xtype l 2>/dev/null); [ -z "$broken" ] && echo OK || printf '%s\n' "$broken"
```

Then smoke-test both tools (e.g. `omp` starts and lists your models; `opencode` loads its
config without errors).

## 7. Environment Variables

The portable config files (`mcp.json`, `models.yml`) and some skills reference
secrets by environment-variable name rather than by value, so they stay
committable. Set these in your shell environment. If you want OMP to expand the
`${ENV_VAR}` references in `mcp.json` and `models.yml` at runtime, also add them
to `config/omp/.env` (the file OMP reads). A template for the required variables
lives in `.env.example` — copy it to `.env` and fill in real values:

```bash
cp .env.example .env   # then edit .env with your own credentials
```

The `.env` file is gitignored.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PERSONAL_ACCESS_TOKEN` | `mcp.json` → "ado" server | Azure DevOps PAT for repo / work-item / PR access |
| `Z_AI_API_KEY` | `mcp.json` → zai-mcp-server, web-reader, web-search-prime, zread | Z.ai (Zhipu) API key for the web-search/reader MCP tools |
| `MICROSOFT_FOUNDRY_API_KEY` | `models.yml` → microsoft-foundry provider | Azure AI Foundry key for hosted models |
| `NVIDIA_API_KEY` | `skills/nvidia-image-gen/` | NVIDIA API key for image generation (must start with `nvapi-`; get at https://build.nvidia.com) |
| `NODE_USE_ENV_PROXY` | `mcp.json` → "ado" env | Optional; set to `1` to make the ado server honour proxy env vars |

These values are required only for the tools/skills that consume them; the rest
of the repo works without them.

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
