#!/usr/bin/env python3
"""
NVIDIA NiM hosted text-to-image generation (FLUX family).

Supports:
  - FLUX.1-dev      via ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev
  - FLUX.1-schnell  via ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell
                    (fast distilled variant — ~4 steps, sub-second generation)

Auth: NVIDIA_API_KEY env var (must start with 'nvapi-').
Output: PNG file (re-encoded from JPEG via PIL if available, else saved as .jpg).

Stdout: the output file path (one line). All diagnostics go to stderr.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

# FLUX family dimension enum (shared across FLUX.1-dev and FLUX.1-schnell).
# Validated against NVIDIA FLUX OpenAPI: width and height must each be one of these.
_FLUX_DIMS = {768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344}

MODELS = {
    "flux-dev": {
        "long_name":        "black-forest-labs/flux.1-dev",
        "url":              "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
        "default_steps":    50,
        "default_cfg":      3.5,
        "max_prompt_chars": 5000,
        "dims":             _FLUX_DIMS,
    },
    "flux-schnell": {
        "long_name":        "black-forest-labs/flux.1-schnell",
        "url":              "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
        "default_steps":    4,     # schnell is distilled for ~4 steps
        "default_cfg":      0.0,   # schnell requires cfg_scale <= 0 (no guidance)
        "max_prompt_chars": 5000,
        "dims":             _FLUX_DIMS,
    },
}

DEFAULT_MODEL = "flux-dev"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def eprint(*args, **kwargs) -> None:
    print(*args, file=sys.stderr, **kwargs)


def slugify(text: str, max_len: int = 50) -> str:
    """Convert a prompt to a filesystem-safe slug."""
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    if not s:
        s = "image"
    return s[:max_len].rstrip("-")


def snap_dimension(value: int, allowed: set[int], name: str) -> int:
    """Snap a dimension to the nearest allowed value, warning if changed."""
    if value in allowed:
        return value
    nearest = min(allowed, key=lambda x: abs(x - value))
    eprint(f"[warn] {name}={value} not supported by this model; snapping to {nearest}")
    return nearest


def unique_path(path: str) -> str:
    """Return path, appending _1, _2, ... if it already exists."""
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    i = 1
    while os.path.exists(f"{base}_{i}{ext}"):
        i += 1
    return f"{base}_{i}{ext}"


def require_api_key() -> str:
    key = os.environ.get("NVIDIA_API_KEY")
    if not key:
        sys.exit("[error] NVIDIA_API_KEY env var is not set. "
                 "Add `export NVIDIA_API_KEY=\"nvapi-...\"` to ~/.secrets.")
    if not key.startswith("nvapi-"):
        sys.exit(f"[error] NVIDIA_API_KEY must start with 'nvapi-' (got prefix: {key[:8]})")
    return key


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def post_json(url: str, headers: dict, body: dict, timeout: int = 180) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode(errors="replace")
        # NVIDIA content-filter refusals come back as 400 with safety markers.
        if e.code == 400 and "safety" in err_body.lower():
            sys.exit("[error] prompt refused by content filter (HTTP 400 safety marker). "
                     "Rephrase and retry.")
        sys.exit(f"[error] HTTP {e.code} from {url}:\n{err_body[:500]}")
    except urllib.error.URLError as e:
        sys.exit(f"[error] network error: {e}")


def extract_image(resp: dict) -> tuple[bytes, int | None]:
    """Return (jpeg_bytes, actual_seed_used_or_None). FLUX native shape:
    {artifacts: [{base64, finishReason, seed}]}."""
    artifacts = resp.get("artifacts", [])
    if not artifacts:
        sys.exit(f"[error] no artifacts in response: {resp}")
    art = artifacts[0]
    if art.get("finishReason") == "CONTENT_FILTERED":
        sys.exit("[error] content filtered by safety checker (finishReason=CONTENT_FILTERED). "
                 "Rephrase and retry.")
    return base64.b64decode(art["base64"]), art.get("seed")


def save_image(jpeg_bytes: bytes, out_path: str) -> str:
    """Save bytes to out_path. Re-encodes JPEG->PNG via PIL if .png requested.
    Falls back to writing JPEG under a .jpg extension if PIL is missing."""
    if out_path.lower().endswith(".png"):
        try:
            from PIL import Image  # type: ignore
            Image.open(io.BytesIO(jpeg_bytes)).save(out_path, format="PNG")
            return out_path
        except ImportError:
            new_path = os.path.splitext(out_path)[0] + ".jpg"
            eprint(f"[warn] PIL not installed; saving as JPEG: {new_path}")
            with open(new_path, "wb") as f:
                f.write(jpeg_bytes)
            return new_path
    with open(out_path, "wb") as f:
        f.write(jpeg_bytes)
    return out_path


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def generate(
    model: str,
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    steps: int | None = None,
    cfg_scale: float | None = None,
    seed: int = 0,
    out_dir: str = ".",
) -> str:
    if model not in MODELS:
        sys.exit(f"[error] unknown model '{model}'. Choices: {list(MODELS)}")
    cfg = MODELS[model]

    api_key = require_api_key()

    # Validate / snap dimensions per-model
    width = snap_dimension(width, cfg["dims"], "width")
    height = snap_dimension(height, cfg["dims"], "height")

    # Prompt length check
    if len(prompt) > cfg["max_prompt_chars"]:
        sys.exit(f"[error] prompt too long ({len(prompt)} > {cfg['max_prompt_chars']} chars)")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept":        "application/json",
        "Content-Type":  "application/json",
    }

    # FLUX native payload (same shape for dev and schnell).
    body = {
        "prompt":    prompt,
        "mode":      "base",
        "width":     width,
        "height":    height,
        "cfg_scale": cfg_scale if cfg_scale is not None else cfg["default_cfg"],
        "steps":     steps if steps is not None else cfg["default_steps"],
        "seed":      seed,
        "samples":   1,
    }

    # Output filename: YYYY-MM-DD_HH-MM-SS_<slug>_<model>.png
    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    slug = slugify(prompt)
    filename = f"{ts}_{slug}_{model}.png"
    os.makedirs(out_dir, exist_ok=True)
    out_path = unique_path(os.path.join(out_dir, filename))

    eprint(f"[info] generating with {model} ({cfg['long_name']}) "
           f"{width}x{height} steps={body.get('steps')} cfg={body.get('cfg_scale')} seed={seed}")
    t0 = time.time()
    resp = post_json(cfg["url"], headers, body)
    jpeg_bytes, actual_seed = extract_image(resp)
    saved_path = save_image(jpeg_bytes, out_path)
    elapsed = time.time() - t0

    eprint(f"[done] {elapsed:.1f}s -> {saved_path}")
    if seed == 0 and actual_seed is not None:
        eprint(f"[info] pass --seed {actual_seed} to reproduce this exact image")
    return saved_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(
        prog="generate.py",
        description="Generate an image via NVIDIA NiM (FLUX.1-dev or FLUX.1-schnell).",
        epilog="Output path printed to stdout. All diagnostics to stderr.",
    )
    p.add_argument("prompt", help="Text prompt for the image")
    p.add_argument("-m", "--model", choices=list(MODELS), default=DEFAULT_MODEL,
                   help=f"Model to use (default: {DEFAULT_MODEL})")
    p.add_argument("-W", "--width", type=int, default=1024, help="Image width in px (default: 1024)")
    p.add_argument("-H", "--height", type=int, default=1024, help="Image height in px (default: 1024)")
    p.add_argument("-s", "--steps", type=int, default=None,
                   help="Inference steps (default: model-specific — 50 for dev, 4 for schnell)")
    p.add_argument("-c", "--cfg-scale", type=float, default=None, dest="cfg_scale",
                   help="CFG scale. Default: 3.5 for flux-dev, 0.0 for flux-schnell "
                        "(schnell requires cfg <= 0).")
    p.add_argument("--seed", type=int, default=0,
                   help="Random seed. 0 = random (actual seed printed to stderr). Non-zero = reproducible.")
    p.add_argument("-d", "--dir", default=".", dest="dir",
                   help="Output directory, created if missing (default: current dir)")
    args = p.parse_args()

    out = generate(
        model=args.model,
        prompt=args.prompt,
        width=args.width,
        height=args.height,
        steps=args.steps,
        cfg_scale=args.cfg_scale,
        seed=args.seed,
        out_dir=args.dir,
    )
    # Only the path goes to stdout — caller can capture with $(...)
    print(out)


if __name__ == "__main__":
    main()
