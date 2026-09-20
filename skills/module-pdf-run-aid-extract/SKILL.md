---
name: module-pdf-run-aid-extract
description: Extract a scanned TSR module PDF in twoee data/ into an Obsidian DM run-aid vault (text layer + vision recovery + maps)
---

# Module PDF → Obsidian Run-Aid Vault

For scanned AD&D module PDFs under `data/` when the user wants a table-ready extract.

## 1. Recon
- `read "data/<path>.pdf:1-3"` — clean text = full OCR layer; garbled/warned = partial.
- Read the whole text layer in chunks; note where `<!-- Page N -->` markers JUMP — textless pages hide there. Textless ≠ map: Vecna Reborn's held TOC, stats, handouts, and whole scene interiors; only 3 of 11 textless pages were maps.
- Confirm file↔print offset by reading a printed folio via vision (Vecna Reborn: file N = printed N+2). Cite FILE pages in the vault (that's what the user opens).

## 2. Render + recover
- Render: `python3 -c "import sys; sys.path.insert(0,'scripts'); from extract_maps import render_pages; from pathlib import Path; render_pages(Path('<pdf>'), Path('maps/<code>'), scale=2.0)"`
- Recover textless pages: `read "maps/<code>/page_NN.png?q=<precise transcription request>"`. For stat blocks demand character-for-character, no-correction transcription; re-query suspicious values independently.
- NEVER reconstruct a garbled stat from memory — vision-verify against the page image (two of my reconstructions were wrong: AC, damage, phantom abilities).

## 3. Vault shape (match oneshots/ house style)
```
campaigns/<module>/
  00 - Session Brief.md      (level range from 'For the DM' page, spoiler rules, spine)
  01 - Domains Primer.md     (setting facts, factions)
  02..0n - Act files         (per scene: > [!info] At a glance, ## Read-Aloud blockquotes verbatim, mechanics numbered, stat links)
  90 - DM Screen.md          (trackers, check DCs, quick-stat table, NPC state)
  NPCs/ Monsters/            (one dossier per stat block; stat verbatim; In-play links acts)
  Handouts/                  (verbatim printed handouts — check the TOC for a Handout entry)
  Maps/                      (copy the map PNGs in; embed ![[Maps/x.png|caption]])
```
- Wiki-links: full path `[[NPCs/Vocar|Vocar]]` or unique basename; NEVER `[[NPCs/]]` (folders don't resolve).
- Anchor links must match heading text exactly (italic `*(PDF p. N)*` suffixes break them — prefer plain file links).

## 4. Verify
- Link sweep: extract all `[[targets]]`, check path-or-unique-basename resolution.
- Stat signatures: grep exact hp/THAC0/XP lines against vision-verified values.
- Grep stale headings/renames, placeholders, and folder-links.
- Preserve print oddities as-printed with a note (e.g. Dellis "I 4", Sergeant/Captain both THAC0 16).

## 5. Delegate
- Fan NPC/Monster dossier compilation to a task agent with stats inlined verbatim in the brief (agent re-reading garbled OCR is the failure mode you're preventing); keep acts/brief/screen authored where the interpretive load is.
