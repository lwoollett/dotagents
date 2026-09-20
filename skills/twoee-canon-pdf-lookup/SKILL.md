---
name: twoee-canon-pdf-lookup
description: "Consult twoee's scanned TSR AD&D 2e PDF library in data/ and trust extracted stats safely"
---

# Canon PDF Lookup (twoee)

Use when a oneshot audit or build needs canon stats/room keys from a published TSR module or rulebook.

## Procedure

1. **Locate the file.** Read `data/` subfolders by setting (`Core/`, `Modules/`, `Ravenloft/`, `Greyhawk/`, `Planescape/`, …) or glob with case-insensitive brackets — glob IS case-sensitive, so `**/*[Vv]ecna*`, not `**/*vecna*`. `data/canon_manifest.csv` may list holdings.
2. **Verify the text layer before trusting it.** `read` a few lines (e.g. `path.pdf:1-3`).
   - Clean text → proceed; grep/read for the needed section.
   - Warning `Text extraction is incomplete for PDF pages …` → image scan, no text layer; render pages and read visually.
3. **OCR trust policy.** Garbled tokens (e.g. `pie Vecna pie!`, `illully puwblu`) mark OCR noise. Never lift hp/damage/XP/THAC0 from noisy OCR as byte-identical — render the page as an image and confirm against the scan (scan is ground truth; printed page beats OCR text).
4. **Cite by file + page** (`<!-- Page N -->` markers) so re-derivation can be re-checked.

## Known text-layer status (verify again before relying)

- `Ravenloft/Vecna Reborn.pdf` — clean OCR.
- `Modules/Die Vecna Die!.pdf` — usable, garbled headers.
- `Greyhawk/WGA4 - Vecna Lives.pdf` — rough OCR; numbers untrustworthy.
- `Ravenloft/RM4 - House Of Strahd.pdf` — no text layer (76-page scan).
