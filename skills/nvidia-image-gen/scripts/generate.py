#!/usr/bin/env python3
"""
NVIDIA NiM hosted text-to-image generation (FLUX family).

Model status (checked 2026-10-07):
  - flux.2-klein-4b   WORKING (fast, ~2-5 s) — DEFAULT
  - flux.1-dev        NVIDIA-side outage since 2026-10-02: requests hang
                      indefinitely or 500 "Retries exhausted". Kept selectable
                      in case it recovers; see the status note printed to stderr.
  - flux.1-schnell    same outage as flux.1-dev.

Auth: NVIDIA_API_KEY env var (must start with 'nvapi-').
Output: PNG file (re-encoded from JPEG via PIL if available, else saved as .jpg).

Stdout: the output file path (one line). All diagnostics go to stderr.
"""
from __future__ import annotations

import argparse
import base64
import datetime
import http.client
import io
import json
import math
import os
import re
import sys
import threading
import time
import urllib.parse

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

# FLUX.1 family dimension enum (dev/schnell).
_FLUX1_DIMS = {768, 832, 896, 960, 1024, 1088, 1152, 1216, 1280, 1344}

# FLUX.2 [klein] supported resolutions — aspect-locked (W, H) PAIRS from the
# model card; width and height cannot be mixed freely across pairs.
_KLEIN_PAIRS = [
    (672, 1568), (688, 1504), (720, 1456), (752, 1392), (800, 1328),
    (832, 1248), (880, 1184), (944, 1104), (1024, 1024), (1104, 944),
    (1184, 880), (1248, 832), (1328, 800), (1392, 752), (1456, 720),
    (1504, 688), (1568, 672),
]

# NVIDIA-side outage of the FLUX.1 backends (dev + schnell) observed since
# 2026-10-02: POSTs hang forever or return 500 "Retries exhausted".
# https://forums.developer.nvidia.com/t/384929
_FLUX1_OUTAGE_NOTE = (
    "NVIDIA's flux.1-dev/flux.1-schnell backends have been timing out since "
    "2026-10-02 (known issue; 500 'Retries exhausted' or endless hangs). "
    "Use `-m flux-klein` (flux.2-klein-4b), which works."
)

MODELS = {
    "flux-klein": {
        "long_name":        "black-forest-labs/flux.2-klein-4b",
        "url":              "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b",
        "api":              "flux2",
        "default_steps":    4,
        # cfg_scale must be EXACTLY 1.0 on this endpoint (validated ge=1, le=1),
        # so we omit it entirely and let the server default apply.
        "cfg_fixed":        1.0,
        "steps_max":        4,
        "max_prompt_chars": 10000,
        "pairs":            _KLEIN_PAIRS,
        "status":           "ok",
    },
    "flux-dev": {
        "long_name":        "black-forest-labs/flux.1-dev",
        "url":              "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
        "api":              "flux1",
        "default_steps":    50,
        "default_cfg":      3.5,
        "cfg_range":        (1.0, 9.0),
        "max_prompt_chars": 5000,
        "dims":             _FLUX1_DIMS,
        "status":           "down (NVIDIA outage since 2026-10-02)",
    },
    "flux-schnell": {
        "long_name":        "black-forest-labs/flux.1-schnell",
        "url":              "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
        "api":              "flux1",
        "default_steps":    4,
        "default_cfg":      0.0,   # schnell requires cfg_scale <= 0 (no guidance)
        "cfg_range":        (None, 0.0),
        "max_prompt_chars": 5000,
        "dims":             _FLUX1_DIMS,
        "status":           "down (NVIDIA outage since 2026-10-02)",
    },
}

DEFAULT_MODEL = "flux-klein"


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
    """Snap a dimension to the nearest allowed enum value (FLUX.1 family)."""
    if value in allowed:
        return value
    nearest = min(allowed, key=lambda x: abs(x - value))
    eprint(f"[warn] {name}={value} not supported by this model; snapping to {nearest}")
    return nearest


def snap_pair(width: int, height: int, pairs: list[tuple[int, int]]) -> tuple[int, int]:
    """Snap (width, height) to the nearest supported aspect-locked pair
    (FLUX.2 klein). Matches aspect ratio first, area second."""
    best = min(
        pairs,
        key=lambda p: (
            abs(math.log(p[0] / p[1]) - math.log(width / height)),  # aspect delta
            abs((p[0] * p[1]) - (width * height)),                   # area delta
        ),
    )
    if best != (width, height):
        eprint(f"[warn] {width}x{height} not a supported resolution for this model; "
               f"snapping to {best[0]}x{best[1]}")
    return best


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

def _timeout_exit(url: str) -> None:
    hint = (_FLUX1_OUTAGE_NOTE if "flux.1-" in url
            else "The endpoint accepted the request but never responded. "
                 "Retry or pick another model.")
    sys.exit(f"[error] timed out waiting for a response from\n  {url}\n        {hint}")


def _do_post(url: str, headers: dict, body: dict, timeout: int) -> dict:
    """Perform one HTTPS POST and return the parsed JSON response.
    May sys.exit() on HTTP errors (SystemExit propagates via the worker
    thread back to the caller)."""
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname
    if parsed.scheme != "https" or not host:
        sys.exit(f"[error] refusing non-https URL: {url}")
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    conn = http.client.HTTPSConnection(host, parsed.port or 443,
                                       timeout=timeout)
    try:
        conn.request("POST", path, body=json.dumps(body), headers=headers)
        resp = conn.getresponse()
        status, raw = resp.status, resp.read()
    except (OSError, http.client.HTTPException) as e:
        conn.close()
        # A read timeout on these endpoints surfaces as a bare TimeoutError
        # (an OSError subclass) — the signature of the FLUX.1 backend outage:
        # connect+TLS succeed, then zero bytes (or an endless dribble) arrive.
        if isinstance(e, TimeoutError):
            _timeout_exit(url)
        sys.exit(f"[error] network error: {e}")
    conn.close()

    if status >= 400:
        err_body = raw.decode(errors="replace")
        # NVIDIA content-filter refusals come back as 400 with safety markers.
        if status == 400 and "safety" in err_body.lower():
            sys.exit("[error] prompt refused by content filter (HTTP 400 safety marker). "
                     "Rephrase and retry.")
        if status == 422:
            sys.exit(f"[error] HTTP 422 (payload rejected) from {url}:\n"
                     f"{format_422(err_body)}")
        sys.exit(f"[error] HTTP {status} from {url}:\n{err_body[:500]}")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError) as e:
        sys.exit(f"[error] non-JSON response from {url}: {e}\n"
                 f"        first 200 bytes: {raw[:200]!r}")


def post_json(url: str, headers: dict, body: dict, timeout: int = 120) -> dict:
    # http.client.HTTPSConnection is https-only by construction — it cannot
    # open file:// or other schemes. URLs themselves come from the hardcoded
    # MODELS registry; still assert the scheme defensively.
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        sys.exit(f"[error] refusing non-https URL: {url}")

    # The HTTP call runs in a daemon worker thread with a hard wall-clock
    # deadline enforced by this (main) thread. Rationale: a wedged gateway
    # can leave the socket stuck in C-level read/write paths where neither
    # the per-recv socket timeout (reset by occasional dribbled bytes) nor
    # SIGALRM (EINTR swallowed inside OpenSSL/sendall) is guaranteed to
    # fire. join(timeout) + os._exit works no matter how deep the wedge.
    result: dict = {}

    def worker() -> None:
        try:
            result["resp"] = _do_post(url, headers, body, timeout)
        except BaseException as e:  # propagate everything, incl. SystemExit
            result["error"] = e

    t = threading.Thread(target=worker, daemon=True, name="nvidia-http")
    t.start()
    t.join(timeout)
    if t.is_alive():
        # Hard wedge: abandon the daemon thread; bypass interpreter teardown
        # (which could block on the wedged thread) and exit immediately.
        eprint(f"[error] no response within {timeout}s from\n  {url}")
        eprint("        " + (_FLUX1_OUTAGE_NOTE if "flux.1-" in url else
                    "The endpoint accepted the request but never responded. "
                    "Retry or pick another model."))
        sys.stderr.flush()
        os._exit(1)
    if "error" in result:
        e = result["error"]
        if isinstance(e, SystemExit):
            raise e
        if isinstance(e, TimeoutError):
            _timeout_exit(url)
        sys.exit(f"[error] {type(e).__name__}: {e}")
    return result["resp"]


def format_422(err_body: str) -> str:
    """Render FastAPI-style 422 detail lists as readable lines."""
    try:
        detail = json.loads(err_body).get("detail", [])
        lines = []
        for item in detail:
            loc = ".".join(str(x) for x in item.get("loc", []))
            lines.append(f"  - {loc}: {item.get('msg')} (got {item.get('input')!r})")
        return "\n".join(lines) or err_body[:500]
    except Exception:
        return err_body[:500]


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
            out_path = new_path
    try:
        with open(out_path, "wb") as f:
            f.write(jpeg_bytes)
    except OSError as e:
        sys.exit(f"[error] cannot write {out_path}: {e}")
    return out_path


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------

def build_body(model_cfg: dict, prompt: str, width: int, height: int,
               steps: int | None, cfg_scale: float | None, seed: int) -> dict:
    """Build the request payload per API family.

    flux1 (dev/schnell): prompt, mode, width, height, cfg_scale, steps, seed,
    samples. cfg constraints: dev (1.0, 9.0]; schnell <= 0.
    flux2 (klein): NO mode field (422 extra_forbidden), cfg_scale must be
    exactly 1.0 (validated ge=1 le=1 → omit), steps <= 4.
    """
    if model_cfg["api"] == "flux2":
        body: dict = {
            "prompt":  prompt,
            "width":   width,
            "height":  height,
            "steps":   steps if steps is not None else model_cfg["default_steps"],
            "seed":    seed,
            "samples": 1,
        }
        if cfg_scale is not None and cfg_scale != model_cfg["cfg_fixed"]:
            sys.exit(f"[error] {model_cfg['long_name']} requires cfg_scale == "
                     f"{model_cfg['cfg_fixed']} (endpoint validates ge/le 1.0); "
                     f"got {cfg_scale}. Just omit -c.")
        return body

    # flux1
    if cfg_scale is None:
        cfg = model_cfg["default_cfg"]
    else:
        lo, hi = model_cfg["cfg_range"]
        if (lo is not None and cfg_scale <= lo) or (hi is not None and cfg_scale > hi):
            sys.exit(f"[error] cfg_scale={cfg_scale} out of range for "
                     f"{model_cfg['long_name']} (allowed: ({lo}, {hi}])")
        cfg = cfg_scale
    return {
        "prompt":    prompt,
        "mode":      "base",
        "width":     width,
        "height":    height,
        "cfg_scale": cfg,
        "steps":     steps if steps is not None else model_cfg["default_steps"],
        "seed":      seed,
        "samples":   1,
    }


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

    if cfg.get("status", "ok") != "ok":
        eprint(f"[warn] model {model} status: {cfg['status']} — proceeding anyway, "
               f"but expect a long hang or HTTP 500. {_FLUX1_OUTAGE_NOTE}")

    # Validate steps
    if steps is not None and "steps_max" in cfg and steps > cfg["steps_max"]:
        sys.exit(f"[error] steps={steps} exceeds max ({cfg['steps_max']}) for "
                 f"{cfg['long_name']}")

    # Validate / snap dimensions per-model
    if "pairs" in cfg:
        width, height = snap_pair(width, height, cfg["pairs"])
    else:
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

    body = build_body(cfg, prompt, width, height, steps, cfg_scale, seed)

    # Output filename: YYYY-MM-DD_HH-MM-SS_<slug>_<model>.png
    ts = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    slug = slugify(prompt)
    filename = f"{ts}_{slug}_{model}.png"
    try:
        os.makedirs(out_dir, exist_ok=True)
    except OSError as e:
        sys.exit(f"[error] cannot create output directory {out_dir}: {e}")
    out_path = unique_path(os.path.join(out_dir, filename))

    eprint(f"[info] generating with {model} ({cfg['long_name']}) "
           f"{width}x{height} steps={body.get('steps')} "
           f"cfg={body.get('cfg_scale', 'server-default')} seed={seed}")
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
        description="Generate an image via NVIDIA NiM (FLUX.2-klein-4b default; "
                    "FLUX.1-dev/schnell selectable but currently affected by an "
                    "NVIDIA-side outage).",
        epilog="Output path printed to stdout. All diagnostics to stderr.",
    )
    p.add_argument("prompt", help="Text prompt for the image")
    p.add_argument("-m", "--model", choices=list(MODELS), default=DEFAULT_MODEL,
                   help=f"Model to use (default: {DEFAULT_MODEL}; flux-dev/flux-schnell "
                        f"currently down NVIDIA-side)")
    p.add_argument("-W", "--width", type=int, default=1024, help="Image width in px (default: 1024)")
    p.add_argument("-H", "--height", type=int, default=1024, help="Image height in px (default: 1024)")
    p.add_argument("-s", "--steps", type=int, default=None,
                   help="Inference steps (default: model-specific — 4 for klein/schnell, 50 for dev; "
                        "klein max 4)")
    p.add_argument("-c", "--cfg-scale", type=float, default=None, dest="cfg_scale",
                   help="CFG scale. Default: model-specific. flux-klein: must be exactly 1.0 "
                        "(omit). flux-dev: (1.0, 9.0], default 3.5. flux-schnell: <= 0, default 0.")
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
