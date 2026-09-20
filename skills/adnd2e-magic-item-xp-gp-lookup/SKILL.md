---
name: adnd2e-magic-item-xp-gp-lookup
description: Look up AD&D 2e magic item XP/GP values (DMG tables + Encyclopedia Magica) when pricing hoards for oneshot vaults
---

# AD&D 2e Magic Item XP/GP Lookup

Use when pricing treasure/hoards for twoee oneshot vaults (AD&D 2e).

## Source

**adnd2e.fandom.com** (transcribes the 2e DMG + Encyclopedia Magica). Fetch wikitext via the MediaWiki API — direct page reads intermittently 403:

```
https://adnd2e.fandom.com/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&titles=Title%20A%7CTitle%20B
```

- Pipe-separate up to 50 titles per call; batch aggressively.
- Item pages carry an `{{Item}}` infobox with `| xp =` and `| value =` (GP).
- DMG table pages: `DMG Table 89` (potions), `90` (scrolls), `95` (books), `98` (boots/gauntlets), `105–107` (armor/shields), `108–110` (weapons). DMG tables give **XP only**.
- EM category tables: `Table R: Armor and Shields (EM)`, `Table S: Weapons (EM)` etc. — these add the **GP column**. EM is the canonical printed 2e GP source.
- Discover exact titles with `action=query&list=search&srsearch=…` or `list=allpages&apprefix=…`.

## Generic +N conventions (2e core)

| Class | +1 | +2 | +3 | +4 | +5 |
|---|---|---|---|---|---|
| Armor/shield XP (DMG T106 = EM R2) | 500 | 1,000 | 1,500 | 2,000 | 3,000 |
| Armor/shield GP (EM R2) | 5,000 | 10,000 | 15,000 | 20,000 | 30,000 |
| Sword XP (DMG T109 = EM S2) | 400 | 800 | 1,400 | 2,000 | 3,000 |
| Other-weapon XP | 500 | 1,000 | — | — | 2,000 (+3) |
| Weapon GP (EM S2) | 5,000 | 5,000 (sword) / 10,000 (other) | 10,000 | 10,000 | 20,000 |

- Variant weapon names price at parent-class values: voulge/bardiche → polearm (other), horseman's mace → mace (other), stiletto/jambiya/dirk → dagger (other), foil/rapier/main-gauche → sword, broad sword → sword.
- Ammunition (arrows/bolts): price the **bundle as one item** (DMG T108 rolls e.g. "Bolt (2d10)" as a single find). Per-missile pricing is never printed and inflates absurdly.
- 2e core awards **no XP for treasure** by default; item XP values are the official item values (item creation / EM valuation / DM option).

## Known discrepancies

- Item description vs random-table XP sometimes differ (e.g. crossbow of speed: entry 3,000 XP/15,000 gp vs DMG T110's 1,500 XP). Use the item entry; footnote the table.
- Potion of extra healing: DMG T89 = 400 XP, EM = 500 XP (GP 1,000 either way). Prefer DMG; footnote.

## Common anchor values (XP / GP)

- Potion of healing 200 / 400; heroism 300 / 500; extra healing 400 / 1,000
- Scroll of protection from undead 1,500 / 4,500; spell scrolls = spell levels × 100 XP
- Keoghtom's ointment 500 / 10,000 (5 applications per jar)
- Boots of striding and springing 2,500 / 20,000
- Dagger of venom 350 / 3,000
- Ring of protection +1 1,000 / 5,000; cloak of protection +1 1,000 / 10,000
- Manual of bodily health 5,000 / 50,000 (all stat tomes)

## Output format

Table: Item | Qty | XP ea. | GP ea. | XP tot | GP tot, grouped per room; separate non-magical GP table (art/coins at stated values, mundane gear at PHB price); magic totals, mundane total, hoard grand total. Footnote every assumption (item classification, bundle pricing, DMG/EM conflicts).
