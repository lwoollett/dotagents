---
name: nvidia-image-gen
description: >
  Generate images from text prompts using NVIDIA NiM. Default model is
  FLUX.2-klein-4b (fast, ~2-5 s). FLUX.1-dev and FLUX.1-schnell are currently
  down NVIDIA-side (outage since 2026-10-02) but remain selectable. Use when
  the user asks to create, generate, make, draw, or render an image, picture,
  illustration, photo, artwork, or poster. Trigger phrases: "generate an image
  of", "create a picture of", "make an illustration", "draw", "render".
---

# Generate Image (NVIDIA NiM — FLUX family)

Generate images from text prompts via NVIDIA's hosted NiM endpoints.

## Current model status (checked 2026-10-07)

| `--model` | Status |
|---|---|
| `flux-klein` (default) | ✅ working — fast (~2-5 s), good quality |
| `flux-dev` | ❌ **NVIDIA backend outage since 2026-10-02** — requests hang (forum-confirmed; 500 "Retries exhausted" or endless timeouts) |
| `flux-schnell` | ❌ same outage as flux-dev |

**Do not use `-m flux-dev` / `-m flux-schnell` until NVIDIA fixes the FLUX.1
backends.** The script warns and still tries (in case it recovers), but enforces
a hard 120 s deadline either way. Re-check status occasionally: a quick
`-m flux-schnell` run that returns an image (or a fast 500) means the outage
is over — update this table and the `status` fields in `scripts/generate.py`.

## When to Use

Use this skill when the user:
- Asks to generate / create / make / draw / render an image, picture, photo, illustration, poster, or artwork
- Wants visual content to accompany text (e.g. "generate a hero banner for ...")
- Asks for AI-generated imagery and no specific backend was requested

## When NOT to Use

- User wants to *edit* an existing image (this skill only generates from text; `flux.1-kontext-dev` on the same account does editing but requires an input image)
- User explicitly asks for a different backend (DALL-E, Midjourney, local Stable Diffusion)
- User needs text rendered accurately *inside* the image (FLUX is weak at text-in-image — recommend a different tool)

## Prerequisites

- `NVIDIA_API_KEY` env var set (starts with `nvapi-`). On this machine it's sourced from `~/.secrets`.

## How to Use

```bash
python ~/.agents/skills/nvidia-image-gen/scripts/generate.py \
  "your prompt here" \
  --width 1024 --height 1024
```

The script prints **only the output path** to stdout (all diagnostics to stderr), so callers can capture it:

```bash
OUT=$(python ~/.agents/skills/nvidia-image-gen/scripts/generate.py "a cat on mars")
echo "Saved to: $OUT"
```

Default output: `./YYYY-MM-DD_HH-MM-SS_<prompt-slug>_<model>.png` in the current working directory.

## Models

| `--model` | Long name | Best for | Typical time |
|---|---|---|---|
| `flux-klein` (default) | `black-forest-labs/flux.2-klein-4b` | Fast, good quality; 4B params; current go-to while FLUX.1 is down | 2–5 s (4 steps) |
| `flux-dev` | `black-forest-labs/flux.1-dev` | Photorealistic, painterly, high quality (50 steps) — **currently down** | was 2–12 s |
| `flux-schnell` | `black-forest-labs/flux.1-schnell` | Fast drafts — **currently down** | was <2 s |

All models use the FLUX native API at
`ai.api.nvidia.com/v1/genai/black-forest-labs/<slug>` and share the response
shape `{artifacts: [{base64, finishReason, seed}]}`. **Payloads differ by
family** — the script handles this; only the differences matter when editing:

- **FLUX.2 klein**: NO `mode` field (422 `extra_forbidden` if sent);
  `cfg_scale` must be **exactly 1.0** (validated ge=1 le=1 → the script omits
  it; don't pass `-c`); `steps` ≤ 4; resolution is an aspect-locked pair list
  (below).
- **FLUX.1 dev**: `mode: "base"` required; `cfg_scale` ∈ (1.0, 9.0], default 3.5.
- **FLUX.1 schnell**: `cfg_scale` ≤ 0 (distilled, no guidance), default 0.

### Dimension constraints — flux-klein (aspect-locked PAIRS)

Width+height must be one of these pairs (aspect-first snapped, with a stderr
warning, if you request something else — e.g. `1344x768` → `1328x800`):

```
672x1568  688x1504  720x1456  752x1392  800x1328  832x1248  880x1184
944x1104  1024x1024 1104x944  1184x880  1248x832  1328x800  1392x752
1456x720  1504x688  1568x672
```

| Ratio | W × H |
|---|---|
| 1:1 (square) | `1024 1024` |
| ~16:9 (landscape) | `1392 752` |
| ~9:16 (portrait) | `752 1392` |
| 3:2 | `1248 832` |
| 2:3 | `832 1248` |
| ~4:3 | `1184 880` |

### Dimension constraints — flux-dev / flux-schnell (independent enums)

Width and height must each be one of:

```
768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344
```

| Ratio | W × H |
|---|---|
| 1:1 (square) | `1024 1024` |
| 16:9 (landscape) | `1344 768` |
| 9:16 (portrait) | `768 1344` |
| 3:2 | `1216 832` |
| 2:3 | `832 1216` |
| 4:3 | `1024 768` |

## Parameters

| Flag | Default | Notes |
|---|---|---|
| `prompt` (positional) | required | The text prompt |
| `-m, --model` | `flux-klein` | One of `flux-klein`, `flux-dev`, `flux-schnell` |
| `-W, --width` | `1024` | Pixels; auto-snapped to nearest supported value/pair |
| `-H, --height` | `1024` | Pixels; auto-snapped |
| `-s, --steps` | model-specific (4 klein/schnell, 50 dev) | klein max 4 |
| `-c, --cfg-scale` | model-specific (klein: server-fixed 1.0) | klein: must be exactly 1.0 — omit. dev: (1.0, 9.0]. schnell: ≤ 0 |
| `--seed` | `0` (random) | 0 = random (actual seed printed to stderr). Non-zero = reproducible (verified: klein echoes the seed back) |
| `-d, --dir` | `.` (CWD) | Output directory; created if missing |

## Examples

```bash
SCRIPT=~/.agents/skills/nvidia-image-gen/scripts/generate.py

# Default: flux-klein, square
python "$SCRIPT" "a studio photo of a brass teapot, soft window light"

# ~16:9 landscape (snaps to a supported pair)
python "$SCRIPT" "a futuristic city at sunset, cyberpunk aesthetic" -W 1344 -H 768

# Reproducible run
python "$SCRIPT" "a watercolor of mt fuji at dawn" --seed 42

# Save to a specific directory
python "$SCRIPT" "hero banner: abstract gradient with soft pastels" \
  -d ~/Pictures/generated/ -W 1392 -H 752
```

## Behaviour Notes

- NVIDIA returns JPEG internally. Output is re-encoded to PNG if PIL is installed, else saved as `.jpg` with a stderr warning.
- **HTTP 200 does not mean the prompt was accepted** — NVIDIA's content filter can return `finishReason: CONTENT_FILTERED` (in-response) or HTTP 400 with safety markers. The script exits non-zero with a clear message in either case.
- Hard wall-clock deadline of 120 s per request. The HTTP call runs in a daemon worker thread and the main thread enforces the deadline — a wedged gateway cannot hang the script forever (the FLUX.1 outage wedges sockets in C-level read paths where socket timeouts and SIGALRM are not reliably delivered; see the outage entry under Troubleshooting).
- Free tier rate limit: ~40 requests/minute per model. HTTP 429 → back off and retry.
- `seed=0` means random — the actual seed NVIDIA assigned is printed to stderr so you can reproduce.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `NVIDIA_API_KEY env var is not set` | Source `~/.secrets` or add to env: `export NVIDIA_API_KEY="nvapi-..."` |
| `must start with 'nvapi-'` | Wrong key format. Get one at https://build.nvidia.com |
| HTTP 401 | Key invalid or revoked — rotate at build.nvidia.com |
| HTTP 404 | Model slug wrong, or model not enrolled on your account. Verify via NVCF: `curl https://api.nvcf.nvidia.com/v2/nvcf/functions -H "Authorization: Bearer $NVIDIA_API_KEY"` |
| HTTP 429 | Rate limited — wait 60s and retry |
| HTTP 400 safety / `CONTENT_FILTERED` | Prompt refused — rephrase and retry |
| `no response within 120s` / `timed out waiting` on flux-dev/flux-schnell | Known NVIDIA outage of the FLUX.1 backends since 2026-10-02 (forum: [t/384929](https://forums.developer.nvidia.com/t/flux-1-dev-returning-500-retries-exhausted-3-3-timeouts-since-oct-2/384929)). Use `-m flux-klein` |
| `PIL not installed; saving as JPEG` | Install Pillow (`pip install pillow`) for true PNG output |

## Adding more models

To add another FLUX-family model, add an entry to the `MODELS` dict in
`scripts/generate.py` with the right `api` family (`flux1` or `flux2` payload
shape) and constraints. E.g. the account also has `flux.1-kontext-dev`
(image **editing** — requires an input image, different payload) and its
function id is discoverable via the NVCF functions list:

```bash
curl -sS https://api.nvcf.nvidia.com/v2/nvcf/functions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" | python3 -m json.tool
```

Probe new endpoints with curl first (bogus-key requests get a fast 401; valid
key + bad payload gets a fast 422 listing constraints) before wiring them in.

## Source / References

- NVIDIA NIM visual-genai docs: https://docs.nvidia.com/nim/visual-genai/latest/
- Model reference (klein): https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_2-klein-4b
- FLUX.1 outage thread: https://forums.developer.nvidia.com/t/384929
- NVCF functions list (definitive source of truth for what your key can access): `GET https://api.nvcf.nvidia.com/v2/nvcf/functions`
