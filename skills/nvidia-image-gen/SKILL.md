---
name: generate-img-nvidia
description: >
  Generate images from text prompts using NVIDIA NiM. Supports the FLUX family —
  FLUX.1-dev for high-quality photorealistic/painterly output (~50 steps), and
  FLUX.1-schnell for fast iteration (~4 steps, sub-second). Use when the user
  asks to create, generate, make, draw, or render an image, picture,
  illustration, photo, artwork, or poster. Trigger phrases: "generate an image
  of", "create a picture of", "make an illustration", "draw", "render".
---

# Generate Image (NVIDIA NiM — FLUX family)

Generate images from text prompts via NVIDIA's hosted NiM endpoints.

## When to Use

Use this skill when the user:
- Asks to generate / create / make / draw / render an image, picture, photo, illustration, poster, or artwork
- Wants visual content to accompany text (e.g. "generate a hero banner for ...")
- Asks for AI-generated imagery and no specific backend was requested

## When NOT to Use

- User wants to *edit* an existing image (this skill only generates from text)
- User explicitly asks for a different backend (DALL-E, Midjourney, local Stable Diffusion)
- User needs text rendered accurately *inside* the image (FLUX is weak at text-in-image — recommend a different tool)

## Prerequisites

- `NVIDIA_API_KEY` env var set (starts with `nvapi-`). On this machine it's sourced from `~/.secrets`.

## How to Use

```bash
python ~/.agents/skills/generate-img-nvidia/scripts/generate.py \
  "your prompt here" \
  --model flux-dev \
  --width 1024 --height 1024
```

The script prints **only the output path** to stdout (all diagnostics to stderr), so callers can capture it:

```bash
OUT=$(python ~/.agents/skills/generate-img-nvidia/scripts/generate.py "a cat on mars" -m flux-dev)
echo "Saved to: $OUT"
```

Default output: `./YYYY-MM-DD_HH-MM-SS_<prompt-slug>_<model>.png` in the current working directory.

## Models

| `--model` | Long name | Best for | Typical time |
|---|---|---|---|
| `flux-dev` (default) | `black-forest-labs/flux.1-dev` | Photorealistic, painterly, general-purpose, high quality | 2–12 s (50 steps) |
| `flux-schnell` | `black-forest-labs/flux.1-schnell` | Fast iteration, drafts, previews. Distilled for ~4 steps | <1–2 s (4 steps) |

Both models use the same FLUX native API at `ai.api.nvidia.com/v1/genai/black-forest-labs/<slug>` and accept the same payload shape (same JSON keys), but **differ in `cfg_scale` constraints**: dev requires `(1.0, 9.0]`, schnell requires `<= 0` (it's a distilled model that doesn't use classifier-free guidance). The script handles this with per-model defaults — only override `-c` if you know what you're doing.

Use `flux-schnell` for quick drafts or while iterating on prompts; switch to `flux-dev` for the final high-quality render.

### Dimension constraints

Both models share the FLUX dimension enum — width and height must each be one of:

```
768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344
```

Out-of-range values are auto-snapped to the nearest valid value (with a stderr warning).

Common aspect ratios:

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
| `-m, --model` | `flux-dev` | One of `flux-dev`, `flux-schnell` |
| `-W, --width` | `1024` | Pixels; auto-snapped to nearest valid value |
| `-H, --height` | `1024` | Pixels; auto-snapped |
| `-s, --steps` | model-specific (50 dev / 4 schnell) | Inference steps |
| `-c, --cfg-scale` | model-specific (3.5 dev / 0.0 schnell) | Guidance scale. **Schnell requires `<= 0`** (distilled, no guidance). Dev range: `(1.0, 9.0]` |
| `--seed` | `0` (random) | 0 = random (actual seed printed to stderr). Non-zero = reproducible |
| `-d, --dir` | `.` (CWD) | Output directory; created if missing |

## Examples

```bash
SCRIPT=~/.agents/skills/generate-img-nvidia/scripts/generate.py

# High-quality square (default)
python "$SCRIPT" "a studio photo of a brass teapot, soft window light"

# Quick draft for iteration
python "$SCRIPT" "idea sketch: a folding bicycle, side view" -m flux-schnell

# 16:9 landscape
python "$SCRIPT" "a futuristic city at sunset, cyberpunk aesthetic" -W 1344 -H 768

# Reproducible run
python "$SCRIPT" "a watercolor of mt fuji at dawn" --seed 42

# Save to a specific directory
python "$SCRIPT" "hero banner: abstract gradient with soft pastels" \
  -m flux-schnell -d ~/Pictures/generated/ -W 1344 -H 768
```

## Behaviour Notes

- NVIDIA returns JPEG internally. Output is re-encoded to PNG if PIL is installed, else saved as `.jpg` with a stderr warning.
- **HTTP 200 does not mean the prompt was accepted** — NVIDIA's content filter can return `finishReason: CONTENT_FILTERED` (in-response) or HTTP 400 with safety markers. The script exits non-zero with a clear message in either case.
- Internal HTTP timeout: 180s. Generations typically take <2s (schnell) or 2–12s (dev).
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
| `PIL not installed; saving as JPEG` | Install Pillow (`pip install pillow`) for true PNG output |

## Adding more models

To add another FLUX-family model (e.g. `flux.1-kontext-dev`, `flux.2-klein-4b`), add an entry to the `MODELS` dict in `scripts/generate.py`:

```python
"flux-kontext": {
    "long_name":        "black-forest-labs/flux.1-kontext-dev",
    "url":              "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev",
    "default_steps":    50,
    "default_cfg":      3.5,
    "max_prompt_chars": 5000,
    "dims":             _FLUX_DIMS,
},
```

Verify the model is available on your account first via the NVCF functions list (see Troubleshooting). Non-FLUX models may need a different payload shape (e.g. OpenAI-compatible `data[0].b64_json` response).

## Source / References

- FLUX.1-dev OpenAPI: https://docs.nvidia.com/nim/visual-genai/latest/_static/_static/yaml/flux.openapi.yaml
- NVCF functions list (definitive source of truth for what your key can access): `GET https://api.nvcf.nvidia.com/v2/nvcf/functions`
