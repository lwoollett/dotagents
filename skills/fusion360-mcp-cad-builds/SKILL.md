---
name: "fusion360-mcp-cad-builds"
description: "Build, verify, and export parametric Fusion 360 geometry via the fusion360-mcp-server execute_code tool — API gotchas for 2026 Fusion/Part-Design docs, boolean traps, angled-cut and body-move workarounds, sketch-surgery limits, viewport renders for vision verification, voronoi lattice recipes, fit-test coupons, and the working export paths"
---

# Building CAD in Fusion 360 via the MCP server

## When
Creating/modifying parametric geometry in Fusion 360 through the fusion360-mcp-server tools — multi-feature parts, keyboard plates, enclosures, voronoi/lattice cases. Use `fusion360_execute_code` for anything beyond 2-3 features; individual tool calls don't scale.

## Procedure
1. **Probe before building.** This Fusion build differs from docs: `component.bRepBodies` (NOT `.bodies`), features expose no `.bodies`, `Line3D` has no `.direction` (compute from start/end points), `BRepBody` has no `deleteObject()`. First call: `json.dumps({'attrs': [a for a in dir(design.rootComponent)...]})` to confirm the surface.
1a. **2026 API geometry names (verified 2026-09):** cylinder class is `adsk.core.Cylinder` (NOT `Cylinder3D`); `Cylinder` has `.origin` (axis point) + `.axis` (Vector3D) but NO `.center`; `adsk.core.Circle` does NOT exist — circular edges surface as `EllipticalArc3D` with `.center/.majorRadius/.minorRadius` (equal radii = circle); `BoundingBox3D` has NO `.center` — average min/max yourself. Hole inventory pattern: walk `body.faces`, filter `g.objectType == adsk.core.Cylinder.classType()`, key by `round(g.radius*10,2)` with `g.origin*10` positions. Body deletion: `root.features.removeFeatures.add(body)` directly (NO createInput).
1b. **Sketch surgery is IMPOSSIBLE in this API**: `SketchPoint.geometry` and `SketchLine.geometry` are read-only, and `Sketch` has no `moveObjects`. To move/resize an existing cut region, build corrective bodies instead: a flat fill-patch (extrude the old region, NewBody) JOINed back, and/or a flat cutter (extrude the new region, taller than the part) combine-CUT — for tilted parts, tilt-move both with the same seating matrix before the boolean. Volume-checks catch mistakes (ΔV must equal the patch/cutter plan-area × thickness exactly).
2. **execute_code is REPL-style**: statements exec'd, last top-level statement eval'd and returned. End every script with a bare `RES` variable set in both the try and except — a trailing try/except block swallows the result AND your own defensive except hides the traceback.
3. **Units are cm internally.** Define `MM = 0.1` and multiply every coordinate/distance (`V(v)` helper for ValueInput).
4. **"Part Design documents can only contain one component"** — 2026 Part-Design docs reject `occurrences.addNewComponent()` AND `constructionPlanes.setByPlane()` ("Environment is not supported"). Work with named BRepBodies in the root component; only native planes (XY + setByOffset) and the YZ/XZ construction planes work.
5. **JOIN merges into EVERY body it touches or pierces** — not just the one you're thinking of. Rules that prevent accidents:
   - Build the reference part completely first; build the overlapping part LAST as `NewBodyFeatureOperation`.
   - Scope every cut: `ei.participantBodies = [body]` — takes a **Python list**, NOT an ObjectCollection.
   - Ring/wall pieces that reach another body: extrude NewBody, then `combineFeatures` into the intended target only.
   - Separate bodies MAY overlap harmlessly; build a plate at its final XY inside the case, then moveFeatures it into place.
   - **Non-touching tool in a JOIN/CUT gets kept as a stray body named "<Target> (N)"** — after every combine, assert `len(root.bRepBodies) == expected` and delete strays with `removeFeatures.add(body)`. Select strays by GEOMETRY (smallest volume), never by name — combine renames results "(N)" unpredictably, and picking bodies via `[b for b in bodies if ...][0]` after strays exist binds the WRONG body (silent cascade).
   - **Guaranteed-join patterns**: join order such that each added body volume-overlaps (not just touches) something already in the target — e.g. bosses stand on uncut floor pads created by fake voronoi seeds; a seating ring joins AFTER bosses so it overlaps boss columns.
6. **Angled cuts without angled planes** (Part Design): build a wedge TOOL body — sketch the trapezoid (slope in sketch coords) on the native `yZConstructionPlane`, `setSymmetricExtent(V(20.0), True)`, then combine-CUT it out of the target. **YZ sketch mapping is (u,v) → global (y=v, z=−u)** — verify with a probe body's bbox (z-extent + y-coverage) before the cut. A wedge at base b cuts everything above z = b + y·tanθ.
7. **Repositioning bodies**: `root.features.moveFeatures.createInput(ObjectCollection([body]), matrix)` WORKS in Part Design. Build rotation matrices with `m.setWithCoordinateSystem(origin, xAxis, yAxis, zAxis)`. Seating transform for tilt θ about the front underside edge at height h: origin (0,0,h·MM), x=(1,0,0), y=(0,cosθ,sinθ), z=(0,−sinθ,cosθ) maps local (x,y,z) → (x, y·cosθ − z·sinθ, h + y·sinθ + z·cosθ). For rotation about arbitrary point c by matrix R (e.g. Rodrigues for tilting cut tools): use origin O = c − R·c with axes = R's columns.
8. **Extrude pattern** (works, verified):
   ```python
   def ext(coll, dist_mm, op, start_mm=None, participants=None, sym_cm=None):
       ei = root.features.extrudeFeatures.createInput(coll, op)
       if start_mm is not None:
           ei.startExtent = adsk.fusion.OffsetStartDefinition.create(V(start_mm))
       if sym_cm is not None:
           ei.setSymmetricExtent(V(sym_cm), True)
       else:
           ei.setDistanceExtent(False, V(dist_mm))  # negative = -Z direction
       if participants is not None:
           ei.participantBodies = list(participants)
       return root.features.extrudeFeatures.add(ei)
   ```
   Profiles: `sk.profiles.item(i)` by index; pick by area via `p.areaProperties().area` (cm²). Multi-profile NewBody extrude → collect created bodies by name-diffing `root.bRepBodies` before/after. Two nested rectangles give TWO profiles (inner + annulus), not three.
8a. **Corner rounds without FilletFeature**: sketch a "sliver" profile per corner — two lines along the square corner plus one `sketchArcs.addByCenterStartSweep(center, startPt, sweep)` (±π/2); cut it through. Assertable by profile count.
8b. **Intersecting curves (slot merging into a bore, tangent circles) must live in SEPARATE sketches/features** — intersecting sketch curves scramble profile topology; the cuts union in geometry.
9. **Verify geometry programmatically**: cylinder-face histogram by radius (hole count/size), bbox per body (×10 for mm), volume vs hand-calc with hard ranges. **The #1 hand-calc trap (hit 3×): subtracted holes remove area × THICKNESS — compute ΔV as plan-area × t, not raw plan areas** (16×14×14mm cutouts in a 1.5mm plate remove 4704mm³, not 3136). When an assert fires on a GOOD build, recompute the expectation before touching geometry. Position audits: every hole must sit in solid material; for tilted assemblies compensate mating features (boss XY = hole local XY under the plate transform).
10. **Recovery is cheap**: `delete_all` + full deterministic rebuild script (fixed `random.Random(seed)` for pattern work) rather than surgical timeline edits. Scripts should assert loudly at each stage (body counts after every combine) so failures leave a readable log. **When a governing dimension changes (case length, plate size), sweep the script for hardcoded literals that DERIVE from it** — shell/prism extrude heights must exceed the wedge-cut plane at the new max extent (a 25.5mm shell height silently flat-chops a rim that grew to 25.8), wedge spans, protection-zone offsets, sketch extents all scale with the dimension; a bbox assert (zmax == 14.5 + L·tanθ) catches the truncation. Fit-test coupons (small flat slices of a feature region, exported as their own STL then `removeFeatures`'d) let hardware iteration happen without reprinting the whole part — build the coupon at an X-offset outside the model, keep its generator as a standalone idempotent script.
11. **Export matrix** (this build):
   - `createSTEPExportOptions(path)` (whole design) → works; with a body arg → broken.
   - `createSTLExportOptions(body, path)` → works (body is arg 1!).
   - `createFusionArchiveExportOptions(path)` → works; snapshot BEFORE destructive rebuilds.
   - Saving is the user's job (Cmd+S).
11a. **Viewport renders** (for vision-model verification): `vp = app.activeViewport; c = vp.camera; c.eye/target/upVector = ...; vp.camera = c; vp.fit(); vp.saveAsImageFile(path, 1200, 900)`. **`vp.camera` returns a singleton — setting `viewOrientation` on it never overrides stale eye/target** (views silently stay isometric). Always set eye/target/upVector explicitly (far distance ≈ 500+mm for quasi-orthographic elevation views); verify the render CONTENT with a vision delegation before trusting it — mis-framed renders produce confident false verdicts about geometry.
12. **Reverse-engineering reference geometry**: STEP is ASCII — regex `CARTESIAN_POINT`. Binary STL: `b''.join(data[84+50*i+12 : 84+50*i+48] ...)` then `struct.iter_unpack('<9f', ...)` (per-record Python loops time out).
13. **MCP plumbing on pi**: pi-mcp-adapter enumerates servers at session start — config edits need a reload. The fusion360 add-in has `runOnStartup: false`: if `execute_code` says "Not connected", check `nc -z localhost 9876`; user runs it from Fusion's ADD-INS dialog. Add-in log at `~/fusion360mcp.log`.
14. **Voronoi/lattice patterns (pure Python, no scipy)** — hard-won recipe:
   - Compute cells by half-plane clipping: cell_i starts as the footprint rect; for every other seed t (real AND fake): keep `{p : |p−s_i|² ≤ |p−t|²}` (Sutherland–Hodgman against the bisector). O(n²), trivial for ≤100 seeds. Cells are convex.
   - Web: inset each cell by web/2 (offset each edge inward along its left normal for CCW polygons; new vertex = intersection of consecutive offset lines; skip degenerate/tiny). **EXCEPT edges lying on the footprint boundary — inset d=0 there, else wall holes become blind pockets behind an uncut skin** (the #1 voronoi bug; floor holes still open because the cut prism passes z<0).
   - **A vertical-prism cut can only make RECTANGULAR openings on vertical walls** — the cell polygon only shows on horizontal faces. For organic wall openings: extrude each cell as its own body, rotate each ±8–14° about a random horizontal axis through its centroid (Rodrigues → setWithCoordinateSystem, see 7), then combine-CUT all from the target. Expect ~1 non-touching stray per 40 tools (cleanup per 5).
   - **Seed layout**: a collinear row of wall seeds produces near-vertical bisectors = rectangular cells; random depths 4–16 shadow deep seeds so coverage collapses. Working pattern: shallow outer ring (3.5–5.5mm deep, jittered 7–10mm spacing) to OWN the wall band, staggered inner ring (11–16mm) to slant the inner boundaries, plus dart-filled interior (min-dist ~11mm). Protection zones: "fake seeds" whose cells are simply never drawn/cut (boss pads, USB/side-slot wall patches, rail pads); also exclude real seeds from those zones.
   - **Seat preservation**: either a flat cut ceiling (z ≈ plane−5 min) — simple, solid rim band everywhere — or full-height cut + a wedge-trimmed ring body re-added (top/bottom trimmed by two parallel wedges 5mm apart; join guaranteed via boss-column overlap).
   - Verify with per-face standard-view renders + vision delegations: "irregular polygons with slanted edges, varied sizes, thin struts" catches all three failure modes (skin pockets, rectangles, sparsity).
